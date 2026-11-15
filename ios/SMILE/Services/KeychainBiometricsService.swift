import Foundation
import LocalAuthentication
import Security

/// Stores teacher login credentials in the iOS Keychain and unlocks them via Face ID / Touch ID.
enum KeychainBiometricsService {
    private static let serviceName = "at.ac.ms-telfs.smile.credentials"
    private static let accountKey = "saved_teacher_login"

    struct SavedCredentials: Codable {
        let username: String
        let password: String
    }

    static var hasSavedCredentials: Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountKey,
            kSecReturnData as String: false,
            // Probe existence without triggering a biometric prompt on launch.
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    static var biometricTypeLabel: String {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return "Face ID / Touch ID"
        }
        switch context.biometryType {
        case .faceID:
            return "Face ID"
        case .touchID:
            return "Touch ID"
        case .opticID:
            return "Optic ID"
        default:
            return "Biometrie"
        }
    }

    static func save(username: String, password: String) {
        guard let data = try? JSONEncoder().encode(SavedCredentials(username: username, password: password)) else {
            return
        }
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountKey
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            return
        }

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountKey,
            kSecValueData as String: data,
            kSecAttrAccessControl as String: accessControl
        ]
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    static func clear() {
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountKey
        ]
        SecItemDelete(deleteQuery as CFDictionary)
    }

    static func unlockWithBiometrics() async throws -> SavedCredentials {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw error ?? NSError(domain: "SMILEBiometrics", code: -1, userInfo: [
                NSLocalizedDescriptionKey: "Face ID / Touch ID ist auf diesem Gerät nicht verfügbar."
            ])
        }

        let success = try await context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Mit Face ID / Touch ID bei SMILE anmelden"
        )
        guard success else {
            throw NSError(domain: "SMILEBiometrics", code: -2, userInfo: [
                NSLocalizedDescriptionKey: "Authentifizierung abgebrochen."
            ])
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let creds = try? JSONDecoder().decode(SavedCredentials.self, from: data) else {
            throw NSError(domain: "SMILEBiometrics", code: -3, userInfo: [
                NSLocalizedDescriptionKey: "Keine gespeicherten Anmeldedaten gefunden."
            ])
        }
        return creds
    }
}
