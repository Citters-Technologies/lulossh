import CCryptoBoringSSL
import Citadel
import Crypto
import Foundation
import NIOCore
import NIOSSH

/*
 * Firma RSA moderna (rsa-sha2-512, RFC 8332) para claves RSA.
 *
 * Citadel firma las claves RSA con SHA-1 ("ssh-rsa"), que OpenSSH rechaza
 * desde la 8.8. NIOSSH usa el mismo nombre para el algoritmo y para el tipo
 * de la clave, así que la clave se presenta como "rsa-sha2-512": OpenSSH la
 * lee como RSA (sshkey_type_from_name lo admite) y verifica con SHA-512.
 * Para servidores antiguos se ofrece después la firma "ssh-rsa" de Citadel.
 */

private enum Mpint {
  /// Entero SSH (mpint): longitud + bytes big-endian, con 0 inicial si el
  /// bit alto está a 1.
  static func write(_ bytes: [UInt8], to buffer: inout ByteBuffer) -> Int {
    var b = Array(bytes.drop(while: { $0 == 0 }))
    if let first = b.first, first & 0x80 != 0 {
      b.insert(0, at: 0)
    }
    return buffer.writeInteger(UInt32(b.count)) + buffer.writeBytes(b)
  }

  static func read(from buffer: inout ByteBuffer) throws -> [UInt8] {
    guard let len = buffer.readInteger(as: UInt32.self),
          let bytes = buffer.readBytes(length: Int(len))
    else { throw RsaSha2Error.malformed }
    return bytes
  }
}

enum RsaSha2Error: Error {
  case malformed
  case signing
  case unsupportedKey
}

private func bnBytes(_ bn: UnsafePointer<BIGNUM>) -> [UInt8] {
  var out = [UInt8](repeating: 0, count: Int(CCryptoBoringSSL_BN_num_bytes(bn)))
  _ = out.withUnsafeMutableBufferPointer { CCryptoBoringSSL_BN_bn2bin(bn, $0.baseAddress!) }
  return out
}

private func bn(_ bytes: [UInt8]) -> UnsafeMutablePointer<BIGNUM> {
  bytes.withUnsafeBufferPointer { CCryptoBoringSSL_BN_bin2bn($0.baseAddress, $0.count, nil)! }
}

final class RsaSha512PublicKey: NIOSSHPublicKeyProtocol {
  static let publicKeyPrefix = "rsa-sha2-512"
  let e: [UInt8]
  let n: [UInt8]

  init(e: [UInt8], n: [UInt8]) {
    self.e = e
    self.n = n
  }

  var rawRepresentation: Data {
    var b = ByteBuffer()
    _ = write(to: &b)
    return Data(b.readableBytesView)
  }

  // Solo se usa para autenticarnos; la verificación la hace el servidor.
  func isValidSignature<D: DataProtocol>(_ signature: NIOSSHSignatureProtocol, for data: D) -> Bool {
    false
  }

  func write(to buffer: inout ByteBuffer) -> Int {
    Mpint.write(e, to: &buffer) + Mpint.write(n, to: &buffer)
  }

  static func read(from buffer: inout ByteBuffer) throws -> RsaSha512PublicKey {
    let e = try Mpint.read(from: &buffer)
    let n = try Mpint.read(from: &buffer)
    return RsaSha512PublicKey(e: e, n: n)
  }
}

struct RsaSha512Signature: NIOSSHSignatureProtocol {
  static let signaturePrefix = "rsa-sha2-512"
  let rawRepresentation: Data

  func write(to buffer: inout ByteBuffer) -> Int {
    buffer.writeInteger(UInt32(rawRepresentation.count)) + buffer.writeBytes(rawRepresentation)
  }

  static func read(from buffer: inout ByteBuffer) throws -> RsaSha512Signature {
    guard let len = buffer.readInteger(as: UInt32.self),
          let bytes = buffer.readBytes(length: Int(len))
    else { throw RsaSha2Error.malformed }
    return RsaSha512Signature(rawRepresentation: Data(bytes))
  }
}

final class RsaSha512PrivateKey: NIOSSHPrivateKeyProtocol {
  static let keyPrefix = "rsa-sha2-512"
  private let d: [UInt8]
  private let pub: RsaSha512PublicKey

  var publicKey: NIOSSHPublicKeyProtocol { pub }

  /// A partir de la clave RSA que ya ha leído (y descifrado) Citadel. Sus
  /// campos son internos: se leen por reflexión.
  init(citadel key: Insecure.RSA.PrivateKey) throws {
    func child(_ v: Any, _ name: String) -> Any? {
      Mirror(reflecting: v).children.first { $0.label == name }?.value
    }
    guard let d = child(key, "privateExponent") as? UnsafeMutablePointer<BIGNUM>,
          let pubKey = child(key, "_publicKey"),
          let e = child(pubKey, "publicExponent") as? UnsafeMutablePointer<BIGNUM>,
          let n = child(pubKey, "modulus") as? UnsafeMutablePointer<BIGNUM>
    else { throw RsaSha2Error.unsupportedKey }
    self.d = bnBytes(d)
    self.pub = RsaSha512PublicKey(e: bnBytes(e), n: bnBytes(n))
  }

  func signature<D: DataProtocol>(for data: D) throws -> NIOSSHSignatureProtocol {
    guard let rsa = CCryptoBoringSSL_RSA_new() else { throw RsaSha2Error.signing }
    defer { CCryptoBoringSSL_RSA_free(rsa) }
    // RSA_set0_key se queda con los BIGNUM (los libera RSA_free).
    guard CCryptoBoringSSL_RSA_set0_key(rsa, bn(pub.n), bn(pub.e), bn(d)) == 1 else {
      throw RsaSha2Error.signing
    }
    let digest = Array(SHA512.hash(data: data))
    var out = [UInt8](repeating: 0, count: Int(CCryptoBoringSSL_RSA_size(rsa)))
    var outLen: UInt32 = 0
    let ok = out.withUnsafeMutableBufferPointer {
      CCryptoBoringSSL_RSA_sign(NID_sha512, digest, digest.count, $0.baseAddress, &outLen, rsa)
    }
    guard ok == 1 else { throw RsaSha2Error.signing }
    return RsaSha512Signature(rawRepresentation: Data(out.prefix(Int(outLen))))
  }
}

/// Autenticación por clave RSA: primero rsa-sha2-512 y, si el servidor no lo
/// acepta (OpenSSH < 7.2), la firma ssh-rsa clásica.
final class RsaKeyAuth: NIOSSHClientUserAuthenticationDelegate {
  private var offers: [NIOSSHPrivateKey]
  private let user: String

  init(user: String, key: Insecure.RSA.PrivateKey) {
    self.user = user
    var list: [NIOSSHPrivateKey] = []
    if let modern = try? RsaSha512PrivateKey(citadel: key) {
      list.append(NIOSSHPrivateKey(custom: modern))
    }
    list.append(NIOSSHPrivateKey(custom: key))
    offers = list
  }

  static func registerAlgorithms() {
    NIOSSHAlgorithms.register(publicKey: RsaSha512PublicKey.self, signature: RsaSha512Signature.self)
  }

  func nextAuthenticationType(
    availableMethods: NIOSSHAvailableUserAuthenticationMethods,
    nextChallengePromise: EventLoopPromise<NIOSSHUserAuthenticationOffer?>
  ) {
    guard availableMethods.contains(.publicKey), !offers.isEmpty else {
      nextChallengePromise.fail(SSHClientError.allAuthenticationOptionsFailed)
      return
    }
    let key = offers.removeFirst()
    nextChallengePromise.succeed(
      NIOSSHUserAuthenticationOffer(username: user, serviceName: "", offer: .privateKey(.init(privateKey: key)))
    )
  }
}
