import Citadel
import Crypto
import Foundation
import GameController
import NIOCore
import NIOSSH
import UIKit

/// Implementa el contrato de src/native/SshModule.ts (versión iOS).
@objc(LuloSsh)
final class LuloSsh: RCTEventEmitter {
  // Estado de las sesiones a nivel de proceso (static): al recargar la
  // interfaz se crea un módulo nuevo y las conexiones siguen abiertas.
  private static let sharedLock = NSLock()
  private static var liveSessions: [String: SshSession] = [:]
  private static var liveConnecting: Set<String> = []
  private static var livePendingHostKeys: [String: EventLoopPromise<Void>] = [:]
  /// Módulo de la interfaz actual (recibe los eventos).
  private static weak var current: LuloSsh?

  private var lock: NSLock { Self.sharedLock }
  private var sessions: [String: SshSession] {
    get { Self.liveSessions }
    set { Self.liveSessions = newValue }
  }
  /// Conexiones en curso; disconnect() las borra para abortar.
  private var connecting: Set<String> {
    get { Self.liveConnecting }
    set { Self.liveConnecting = newValue }
  }
  private var pendingHostKeys: [String: EventLoopPromise<Void>] {
    get { Self.livePendingHostKeys }
    set { Self.livePendingHostKeys = newValue }
  }

  override init() {
    super.init()
    Self.current = self
  }
  private let vault = Vault()
  private let prefs = UserDefaults(suiteName: "lulossh_ui") ?? .standard

  private static let hostKeyWait: TimeInterval = 120
  private static let probeTimeout: UInt64 = 6

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["data", "closed", "hostKey", "error", "termInput", "termShortcut", "volumeKey"]
  }

  /// El modo claro/oscuro tiene que conocerse antes de crear los estilos.
  override func constantsToExport() -> [AnyHashable: Any]! {
    ["appTheme": prefs.string(forKey: "appTheme") ?? "dark"]
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    (Self.current ?? self).sendEvent(withName: name, body: body)
  }

  private func locked<T>(_ f: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return f()
  }

  // MARK: - Conexión

  @objc(connect:resolve:reject:)
  func connect(_ opts: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let id = opts["sessionId"] as? String ?? UUID().uuidString
    Task {
      do {
        try await self.doConnect(id: id, opts: opts)
        resolve(id)
      } catch is VaultLocked {
        reject("LOCKED", "Vault bloqueado", nil)
      } catch {
        reject(error is CancellationError ? "CANCELLED" : "CONNECT_ERROR", self.describe(error, opts: opts), error)
      }
    }
  }

  private func doConnect(id: String, opts: NSDictionary) async throws {
    let host = opts["host"] as? String ?? ""
    let port = (opts["port"] as? NSNumber)?.intValue ?? 22
    let user = opts["username"] as? String ?? ""
    let auth = opts["auth"] as? NSDictionary ?? [:]
    let cols = (opts["cols"] as? NSNumber)?.intValue ?? 80
    let rows = (opts["rows"] as? NSNumber)?.intValue ?? 24
    let term = opts["term"] as? String ?? "xterm-256color"
    let known = opts["knownHostFingerprint"] as? String
    let title = opts["title"] as? String ?? "\(user)@\(host)"
    let hostId = opts["hostId"] as? String

    let method: SSHAuthenticationMethod
    switch auth["type"] as? String {
    case "password":
      method = .passwordBased(username: user, password: auth["password"] as? String ?? "")
    case "privateKey":
      let keyId = auth["keyId"] as? String ?? ""
      guard let pem = try vault.get(Vault.privateKeyName(keyId)) else {
        throw ConnectFailure(message: "Clave no encontrada")
      }
      let pass = try vault.get(Vault.passphraseName(keyId))
      method = try KeyTools.load(pem, passphrase: pass).auth(user: user)
    default:
      throw ConnectFailure(message: "Método de auth desconocido")
    }

    locked { _ = connecting.insert(id) }
    defer { locked { _ = connecting.remove(id) } }

    let check = HostKeyCheck(known: known) { [weak self] fp, changed, promise in
      guard let self else { return promise.fail(HostKeyRejected()) }
      self.locked { self.pendingHostKeys[id] = promise }
      self.emit("hostKey", ["sessionId": id, "fingerprint": fp, "changed": changed])
      DispatchQueue.global().asyncAfter(deadline: .now() + Self.hostKeyWait) {
        self.answerHostKey(id, accept: false)
      }
    }

    let client = try await SSHClient.connect(
      host: host,
      port: port,
      authenticationMethod: method,
      hostKeyValidator: .custom(check),
      reconnect: .never,
      connectTimeout: .seconds(15)
    )
    guard locked({ connecting.contains(id) }) else {
      try? await client.close()
      throw CancellationError()
    }

    let sess = SshSession(id: id, client: client, hostId: hostId, title: title)
    let ready = Once()
    sess.task = Task { await self.runShell(sess, term: term, cols: cols, rows: rows, ready: ready) }
    do {
      try await ready.wait()
    } catch {
      try? await client.close()
      throw error
    }
    guard locked({ connecting.contains(id) }) else {
      closeSession(id, sess)
      throw CancellationError()
    }
  }

  /// Abre la shell con PTY y bombea su salida a JS hasta que se cierre.
  private func runShell(_ sess: SshSession, term: String, cols: Int, rows: Int, ready: Once) async {
    let req = SSHChannelRequestEvent.PseudoTerminalRequest(
      wantReply: true,
      term: term,
      terminalCharacterWidth: cols,
      terminalRowHeight: rows,
      terminalPixelWidth: 0,
      terminalPixelHeight: 0,
      terminalModes: SSHTerminalModes([:])
    )
    var started = false
    var reason: String?
    do {
      try await sess.client.withPTY(req) { inbound, outbound in
        started = true
        locked { sessions[sess.id] = sess }
        ready.resolve(.success(()))
        // Escrituras y cambios de tamaño en orden, en su propia tarea.
        let writer = Task {
          for await item in sess.outbox {
            switch item {
            case .data(let d):
              try? await outbound.write(ByteBuffer(bytes: d))
            case .resize(let c, let r):
              try? await outbound.changeSize(cols: c, rows: r, pixelWidth: 0, pixelHeight: 0)
            }
          }
        }
        defer { writer.cancel() }
        for try await chunk in inbound {
          let buf: ByteBuffer
          switch chunk {
          case .stdout(let b): buf = b
          case .stderr(let b): buf = b
          }
          let bytes = Array(buf.readableBytesView)
          sess.history.append(bytes)
          emit("data", ["sessionId": sess.id, "base64": Data(bytes).base64EncodedString()])
        }
      }
    } catch is SSHClient.CommandFailed {
      // La shell salió con código != 0: cierre normal.
    } catch {
      if !started {
        ready.resolve(.failure(error))
        return
      }
      reason = describe(error, opts: nil)
    }
    if let d = sess.deadReason { reason = d }
    var body: [String: Any] = ["sessionId": sess.id]
    if let reason { body["reason"] = reason }
    emit("closed", body)
    closeSession(sess.id, sess)
  }

  /// Mensajes de error comprensibles, como en Android.
  private func describe(_ error: Error, opts: NSDictionary?) -> String {
    let host = opts?["host"] as? String ?? ""
    let port = (opts?["port"] as? NSNumber)?.intValue ?? 22
    let user = opts?["username"] as? String ?? ""
    if let e = error as? LocalizedError, let d = e.errorDescription, error is ConnectFailure || error is VaultError {
      return d
    }
    if error is HostKeyRejected { return "Huella del servidor no aceptada" }
    if let e = error as? SSHClientError {
      switch e {
      case .allAuthenticationOptionsFailed:
        return "Autenticación rechazada para \(user) (contraseña o clave incorrecta)"
      case .unsupportedPasswordAuthentication:
        return "El servidor no acepta contraseña para \(user) (¿solo clave o keyboard-interactive?)"
      case .unsupportedPrivateKeyAuthentication:
        return "El servidor no acepta clave pública para \(user)"
      default:
        break
      }
    }
    let text = String(describing: error)
    if text.contains("connectTimeout") || text.contains("timeout") {
      return "No responde \(host):\(port) (timeout). ¿Está el dispositivo en la misma red o VPN que el servidor?"
    }
    if text.contains("Connection refused") || text.contains("ECONNREFUSED") {
      return "Conexión rechazada en \(host):\(port). ¿Puerto correcto y sshd activo?"
    }
    if text.contains("dns") || text.contains("DNS") || text.contains("nodename") {
      return "No se encuentra el host \"\(host)\" (DNS)"
    }
    return text
  }

  private func answerHostKey(_ id: String, accept: Bool) {
    guard let p = locked({ pendingHostKeys.removeValue(forKey: id) }) else { return }
    if accept { p.succeed(()) } else { p.fail(HostKeyRejected()) }
  }

  @objc(acceptHostKey:accept:resolve:reject:)
  func acceptHostKey(_ id: String, accept: Bool, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    answerHostKey(id, accept: accept)
    resolve(nil)
  }

  private func session(_ id: String) -> SshSession? { locked { sessions[id] } }

  @objc(write:base64:resolve:reject:)
  func write(_ id: String, base64: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    guard let s = session(id) else { return reject("NO_SESSION", "Sesión inexistente", nil) }
    guard let d = Data(base64Encoded: base64) else { return reject("WRITE_ERROR", "base64 no válido", nil) }
    s.outboxIn.yield(.data(d))
    resolve(nil)
  }

  @objc(resize:cols:rows:resolve:reject:)
  func resize(_ id: String, cols: NSNumber, rows: NSNumber, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    guard let s = session(id) else { return reject("NO_SESSION", "Sesión inexistente", nil) }
    s.outboxIn.yield(.resize(cols: cols.intValue, rows: rows.intValue))
    resolve(nil)
  }

  @objc(disconnect:resolve:reject:)
  func disconnect(_ id: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    closeSession(id, nil)
    resolve(nil)
  }

  private func closeSession(_ id: String, _ only: SshSession?) {
    answerHostKey(id, accept: false)
    let s: SshSession? = locked {
      connecting.remove(id)
      guard let cur = sessions[id], only == nil || cur === only else { return nil }
      sessions.removeValue(forKey: id)
      return cur
    }
    let target = s ?? only
    guard let target else { return }
    target.outboxIn.finish()
    Task { try? await target.client.close() }
  }

  /// Comando corto en un canal aparte (no toca la shell). Devuelve stdout.
  @objc(exec:command:timeoutMs:resolve:reject:)
  func exec(_ id: String, command: String, timeoutMs: NSNumber, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let s = session(id) else { return reject("NO_SESSION", "Sesión inexistente", nil) }
    let ms = min(max(timeoutMs.intValue, 1000), 30000)
    Task {
      let out = DataBox()
      _ = await withDeadline(Double(ms) / 1000) {
        do {
          let stream = try await s.client.executeCommandStream(command)
          for try await chunk in stream {
            if case .stdout(let b) = chunk { out.append(Data(b.readableBytesView)) }
            if out.count >= 65536 { break }
          }
        } catch {}
      }
      resolve(String(decoding: out.data, as: UTF8.self))
    }
  }

  // MARK: - Sesiones en segundo plano

  @objc(listSessions:reject:)
  func listSessions(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    let list = locked { sessions.values.sorted { $0.startedAt < $1.startedAt } }
    resolve(list.map {
      [
        "sessionId": $0.id,
        "hostId": $0.hostId ?? NSNull(),
        "title": $0.title,
        "startedAt": $0.startedAt.timeIntervalSince1970 * 1000,
      ] as [String: Any]
    })
  }

  @objc(attach:resolve:reject:)
  func attach(_ id: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    guard let s = session(id) else { return reject("NO_SESSION", "La sesión ya no existe", nil) }
    resolve(Data(s.history.snapshot()).base64EncodedString())
  }

  @objc(consumePendingOpen:reject:)
  func consumePendingOpen(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(nil)
  }

  /**
   * Comprueba que cada sesión sigue viva. iOS corta los sockets al pasar a
   * segundo plano y tras un cambio de red pueden quedar muertos sin error:
   * si no responde un comando trivial en unos segundos, se cierra con motivo.
   */
  @objc func probeSessions() {
    for s in locked({ Array(sessions.values) }) {
      Task {
        // Cualquier respuesta (aunque sea un error del comando) prueba que vive.
        let answered = await withDeadline(Double(Self.probeTimeout)) {
          _ = try? await s.client.executeCommand("true")
        } != nil
        if !answered || !s.client.isConnected, self.session(s.id) === s {
          s.deadReason = "sin respuesta del servidor (cambio de red o la app estuvo en segundo plano)"
          try? await s.client.close()
        }
      }
    }
  }

  // MARK: - Vault

  @objc(unlock:resolve:reject:)
  func unlock(_ reason: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vault.unlock(reason: reason) { err in
      if let err { reject("UNLOCK_FAILED", err.localizedDescription, err) } else { resolve(nil) }
    }
  }

  private func vaultCall(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock, _ f: @escaping () throws -> Any?) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        resolve(try f())
      } catch is VaultLocked {
        reject("LOCKED", "Vault bloqueado", nil)
      } catch {
        reject("VAULT_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc(secureGet:resolve:reject:)
  func secureGet(_ name: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) { try self.vault.get(Vault.valueName(name)) }
  }

  @objc(secureSet:value:resolve:reject:)
  func secureSet(_ name: String, value: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) { try self.vault.put(Vault.valueName(name), value); return nil }
  }

  @objc(secureDelete:resolve:reject:)
  func secureDelete(_ name: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) { self.vault.delete(Vault.valueName(name)); return nil }
  }

  @objc(generateKey:comment:resolve:reject:)
  func generateKey(_ keyId: String, comment: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) {
      let k = Curve25519.Signing.PrivateKey()
      try self.vault.put(Vault.privateKeyName(keyId), k.makeSSHRepresentation())
      return ["type": "ssh-ed25519", "publicKey": KeyTools.publicKeyLine(.ed25519(k), comment: comment)]
    }
  }

  @objc(importKey:pem:passphrase:comment:resolve:reject:)
  func importKey(_ keyId: String, pem: String, passphrase: String?, comment: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) {
      let key: KeyTools.Loaded
      do {
        key = try KeyTools.load(pem, passphrase: passphrase)
      } catch let e as VaultError {
        throw e
      } catch {
        throw VaultError(message: "Clave no válida o passphrase incorrecta")
      }
      try self.vault.put(Vault.privateKeyName(keyId), pem)
      if let p = passphrase, !p.isEmpty { try self.vault.put(Vault.passphraseName(keyId), p) }
      return ["type": key.typeName, "publicKey": KeyTools.publicKeyLine(key, comment: comment)]
    }
  }

  @objc(deleteKey:resolve:reject:)
  func deleteKey(_ keyId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    vaultCall(resolve, reject) {
      self.vault.delete(Vault.privateKeyName(keyId))
      self.vault.delete(Vault.passphraseName(keyId))
      return nil
    }
  }

  // MARK: - Interfaz

  // En iOS la terminal usa el teclado del propio WebView (ver TerminalView).
  @objc func showKeyboard() {}
  @objc(hideKeyboard:) func hideKeyboard(_ detach: Bool) {}
  @objc func ensureKeyboardFocus() {}

  @objc(hasHardwareKeyboard:reject:)
  func hasHardwareKeyboard(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(GCKeyboard.coalesced != nil)
  }
  @objc(setVolumeKeysEnabled:) func setVolumeKeysEnabled(_ enabled: Bool) {}

  @objc(prefGet:resolve:reject:)
  func prefGet(_ name: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(prefs.string(forKey: name))
  }

  @objc(prefSet:value:resolve:reject:)
  func prefSet(_ name: String, value: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    prefs.set(value, forKey: name)
    resolve(nil)
  }

  /// Recarga JS para aplicar el modo claro/oscuro (cierra antes las sesiones).
  @objc func reloadUi() {
    // Las sesiones sobreviven a la recarga (estado static).
    DispatchQueue.main.async { RCTTriggerReloadCommandListeners("Cambio de tema") }
  }

  @objc(copyText:)
  func copyText(_ text: String) {
    DispatchQueue.main.async { UIPasteboard.general.string = text }
  }

  @objc(pasteText:reject:)
  func pasteText(_ resolve: @escaping RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async { resolve(UIPasteboard.general.string) }
  }

  // MARK: - Pendiente en iOS

  @objc(pickImportFiles:reject:)
  func pickImportFiles(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Importar ficheros aún no está disponible en iOS", nil)
  }

  @objc(isJuiceSshInstalled:reject:)
  func isJuiceSshInstalled(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(false) // JuiceSSH solo existe en Android.
  }

  @objc(readJuiceSsh:reject:)
  func readJuiceSsh(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "JuiceSSH solo existe en Android", nil)
  }

  @objc(exportBackup:keyIds:password:fileName:resolve:reject:)
  func exportBackup(_ metaJson: String, keyIds: NSArray, password: String, fileName: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Copia de seguridad aún no disponible en iOS", nil)
  }

  @objc(decryptBackup:password:resolve:reject:)
  func decryptBackup(_ content: String, password: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Copia de seguridad aún no disponible en iOS", nil)
  }

  @objc(decryptXshellPasswords:blobs:resolve:reject:)
  func decryptXshellPasswords(_ master: String, blobs: NSArray, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Importación de Xshell aún no disponible en iOS", nil)
  }
}

/// Acumulador thread-safe.
final class DataBox {
  private var d = Data()
  private let lock = NSLock()
  func append(_ x: Data) { lock.lock(); d.append(x); lock.unlock() }
  var count: Int { lock.lock(); defer { lock.unlock() }; return d.count }
  var data: Data { lock.lock(); defer { lock.unlock() }; return d }
}

/// Ejecuta op con límite de tiempo: nil si vence (op se cancela y se abandona,
/// sin esperarla, por si una operación de red muerta no atiende la cancelación).
func withDeadline<T>(_ seconds: Double, _ op: @escaping () async -> T) async -> T? {
  let lock = NSLock()
  var done = false
  func take() -> Bool {
    lock.lock(); defer { lock.unlock() }
    if done { return false }
    done = true
    return true
  }
  return await withCheckedContinuation { (c: CheckedContinuation<T?, Never>) in
    let work = Task {
      let v = await op()
      if take() { c.resume(returning: v) }
    }
    Task {
      try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      if take() {
        work.cancel()
        c.resume(returning: nil)
      }
    }
  }
}
