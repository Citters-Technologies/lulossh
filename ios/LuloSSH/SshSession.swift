import Citadel
import Crypto
import Foundation
import NIOCore
import NIOSSH

/// Buffer circular de bytes (últimos N bytes de salida), thread-safe.
final class ByteRing {
  private var buf: [UInt8]
  private var start = 0
  private var size = 0
  private let lock = NSLock()

  init(capacity: Int) { buf = [UInt8](repeating: 0, count: capacity) }

  func append(_ bytes: [UInt8]) {
    lock.lock()
    defer { lock.unlock() }
    let cap = buf.count
    for b in bytes.suffix(cap) {
      buf[(start + size) % cap] = b
      if size < cap { size += 1 } else { start = (start + 1) % cap }
    }
  }

  func snapshot() -> [UInt8] {
    lock.lock()
    defer { lock.unlock() }
    return (0..<size).map { buf[(start + $0) % buf.count] }
  }
}

/// Lo que se manda a la shell, en orden: datos o cambio de tamaño.
enum Outgoing {
  case data(Data)
  case resize(cols: Int, rows: Int)
}

/// Una sesión SSH abierta (conexión + shell con PTY).
final class SshSession {
  let id: String
  let client: SSHClient
  let hostId: String?
  let title: String
  let startedAt = Date()
  let history = ByteRing(capacity: 256 * 1024)
  let outbox: AsyncStream<Outgoing>
  let outboxIn: AsyncStream<Outgoing>.Continuation
  var task: Task<Void, Never>?
  /// Motivo si la cerramos nosotros por estar muerta (sondeo fallido).
  var deadReason: String?

  init(id: String, client: SSHClient, hostId: String?, title: String) {
    self.id = id
    self.client = client
    self.hostId = hostId
    self.title = title
    (outbox, outboxIn) = AsyncStream<Outgoing>.makeStream()
  }
}

/// Promesa de un solo uso para esperar a que la shell esté lista.
final class Once {
  private var cont: CheckedContinuation<Void, Error>?
  private var result: Result<Void, Error>?
  private let lock = NSLock()

  func resolve(_ r: Result<Void, Error>) {
    lock.lock()
    if result != nil { lock.unlock(); return }
    result = r
    let c = cont
    cont = nil
    lock.unlock()
    c?.resume(with: r)
  }

  func wait() async throws {
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      lock.lock()
      if let r = result {
        lock.unlock()
        c.resume(with: r)
      } else {
        cont = c
        lock.unlock()
      }
    }
  }
}

struct ConnectFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

enum KeyTools {
  /// Blob SSH (wire format) de una clave pública.
  static func publicBlob(_ key: NIOSSHPublicKey) -> Data {
    let line = String(openSSHPublicKey: key)
    let b64 = line.split(separator: " ").dropFirst().first.map(String.init) ?? ""
    return Data(base64Encoded: b64) ?? Data()
  }

  /// Huella MD5 "aa:bb:…", el mismo formato que guarda la versión Android
  /// (sshj), para que las huellas conocidas sirvan en ambas plataformas.
  static func fingerprintMD5(_ key: NIOSSHPublicKey) -> String {
    Insecure.MD5.hash(data: publicBlob(key)).map { String(format: "%02x", $0) }.joined(separator: ":")
  }

  static func fingerprintSHA256(_ key: NIOSSHPublicKey) -> String {
    let b64 = Data(SHA256.hash(data: publicBlob(key))).base64EncodedString()
    return "SHA256:" + b64.replacingOccurrences(of: "=", with: "")
  }

  enum Loaded {
    case ed25519(Curve25519.Signing.PrivateKey)
    case rsa(Insecure.RSA.PrivateKey)

    var typeName: String {
      switch self {
      case .ed25519: return "ssh-ed25519"
      case .rsa: return "ssh-rsa"
      }
    }

    var nioKey: NIOSSHPrivateKey {
      switch self {
      case .ed25519(let k): return NIOSSHPrivateKey(ed25519Key: k)
      case .rsa(let k): return NIOSSHPrivateKey(custom: k)
      }
    }

    func auth(user: String) -> SSHAuthenticationMethod {
      switch self {
      case .ed25519(let k): return .ed25519(username: user, privateKey: k)
      // rsa-sha2-512 primero (OpenSSH moderno), ssh-rsa como reserva.
      case .rsa(let k): return .custom(RsaKeyAuth(user: user, key: k))
      }
    }
  }

  /// Carga una clave privada OpenSSH (valida formato y passphrase).
  static func load(_ pem: String, passphrase: String?) throws -> Loaded {
    let pass = (passphrase?.isEmpty == false) ? Data(passphrase!.utf8) : nil
    let text = pem.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.hasPrefix("-----BEGIN OPENSSH PRIVATE KEY-----") else {
      throw VaultError(message: "En iOS, de momento solo claves en formato OpenSSH (BEGIN OPENSSH PRIVATE KEY)")
    }
    let type = try SSHKeyDetection.detectPrivateKeyType(from: text)
    switch type {
    case .ed25519:
      return .ed25519(try Curve25519.Signing.PrivateKey(sshEd25519: text, decryptionKey: pass))
    case .rsa:
      return .rsa(try Insecure.RSA.PrivateKey(sshRsa: text, decryptionKey: pass))
    default:
      throw VaultError(message: "Tipo de clave \(type) aún no soportado en iOS")
    }
  }

  /// Línea authorized_keys: "<tipo> <base64> <comentario>".
  static func publicKeyLine(_ key: Loaded, comment: String) -> String {
    "\(String(openSSHPublicKey: key.nioKey.publicKey)) \(comment)"
      .trimmingCharacters(in: .whitespaces)
  }
}

/// Verificación de la huella del servidor: si no es la conocida, pregunta a JS.
final class HostKeyCheck: NIOSSHClientServerAuthenticationDelegate {
  let known: String?
  let ask: (_ fingerprint: String, _ changed: Bool, _ promise: EventLoopPromise<Void>) -> Void

  init(known: String?, ask: @escaping (String, Bool, EventLoopPromise<Void>) -> Void) {
    self.known = known
    self.ask = ask
  }

  func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
    let md5 = KeyTools.fingerprintMD5(hostKey)
    if let k = known, k == md5 || k == KeyTools.fingerprintSHA256(hostKey) {
      validationCompletePromise.succeed(())
      return
    }
    ask(md5, known != nil, validationCompletePromise)
  }
}

struct HostKeyRejected: Error {}
