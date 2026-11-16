import Foundation
import LocalAuthentication
import Security

/// El usuario no se ha autenticado recientemente: JS debe llamar a unlock().
struct VaultLocked: Error {}

struct VaultError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/**
 * Almacén de secretos en el Keychain (solo este dispositivo, solo con el
 * iPhone desbloqueado, fuera de las copias de iCloud). Como en Android, el
 * acceso exige haberse autenticado con Face ID / Touch ID / código en los
 * últimos AUTH_WINDOW_S segundos (ver unlock()).
 */
final class Vault {
  static let authWindow: TimeInterval = 300
  private let service = "com.citters.lulossh.vault"
  private let lock = NSLock()
  private var unlockedUntil = Date.distantPast

  static func privateKeyName(_ id: String) -> String { "key:\(id)" }
  static func passphraseName(_ id: String) -> String { "keypass:\(id)" }
  static func valueName(_ name: String) -> String { "kv:\(name)" }

  /// Pide Face ID / Touch ID o el código del dispositivo.
  func unlock(reason: String, done: @escaping (Error?) -> Void) {
    let ctx = LAContext()
    ctx.localizedCancelTitle = "Cancelar"
    var err: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
      done(VaultError(message: "Configura un código o Face ID en el dispositivo"))
      return
    }
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, e in
      if ok {
        self.lock.lock()
        self.unlockedUntil = Date().addingTimeInterval(Vault.authWindow)
        self.lock.unlock()
        done(nil)
      } else {
        done(VaultError(message: e?.localizedDescription ?? "Cancelado"))
      }
    }
  }

  private func ensureUnlocked() throws {
    lock.lock()
    defer { lock.unlock() }
    if Date() > unlockedUntil { throw VaultLocked() }
  }

  private func baseQuery(_ name: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: name,
    ]
  }

  func get(_ name: String) throws -> String? {
    try ensureUnlocked()
    var q = baseQuery(name)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let st = SecItemCopyMatching(q as CFDictionary, &out)
    if st == errSecItemNotFound { return nil }
    guard st == errSecSuccess, let data = out as? Data else {
      throw VaultError(message: "Keychain: error \(st)")
    }
    return String(data: data, encoding: .utf8)
  }

  func put(_ name: String, _ value: String) throws {
    try ensureUnlocked()
    let data = Data(value.utf8)
    let upd: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    var st = SecItemUpdate(baseQuery(name) as CFDictionary, upd as CFDictionary)
    if st == errSecItemNotFound {
      var add = baseQuery(name)
      add.merge(upd) { _, b in b }
      st = SecItemAdd(add as CFDictionary, nil)
    }
    guard st == errSecSuccess else { throw VaultError(message: "Keychain: error \(st)") }
  }

  func delete(_ name: String) {
    SecItemDelete(baseQuery(name) as CFDictionary)
  }
}
