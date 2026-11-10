import Foundation
import Security

/// Keychain-backed storage with UserDefaults fallback when Keychain is unavailable
/// (unsigned simulator installs, missing entitlements, etc.).
enum KeychainStore {
    static let service = "io.appkeep.ponder.mobile"

    enum Key {
        static let session = "ponder.mobile.session"
        static let deviceId = "ponder.mobile.device-id"
    }

    private static let fallbackPrefix = "ponder.keychain.fallback."

    static func setString(_ value: String, forKey key: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess {
            UserDefaults.standard.removeObject(forKey: fallbackPrefix + key)
            return
        }
        // Fallback for environments where Keychain is restricted.
        UserDefaults.standard.set(value, forKey: fallbackPrefix + key)
        if status != errSecDuplicateItem && status != errSecInteractionNotAllowed && status != errSecMissingEntitlement {
            // Still record unusual codes but do not fail the app bootstrap path.
            #if DEBUG
            print("KeychainStore.setString fallback status=\(status) key=\(key)")
            #endif
        }
    }

    static func string(forKey key: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) {
            return value
        }
        if status == errSecItemNotFound || status != errSecSuccess {
            return UserDefaults.standard.string(forKey: fallbackPrefix + key)
        }
        return UserDefaults.standard.string(forKey: fallbackPrefix + key)
    }

    static func delete(forKey key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: fallbackPrefix + key)
    }
}

enum KeychainError: Error {
    case unhandled(OSStatus)
}
