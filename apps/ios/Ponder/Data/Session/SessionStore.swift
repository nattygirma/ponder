import Foundation
import Observation

@Observable
@MainActor
final class SessionStore {
    private(set) var isLoading = true
    private(set) var session: MobileSession?
    private(set) var lastError: String?

    let client: APIClient
    private let keychainSessionKey = KeychainStore.Key.session

    init(client: APIClient = APIClient(baseURL: URL(string: "https://localhost")!)) {
        self.client = client
    }

    var isSignedIn: Bool { session != nil }

    var dataScope: String? {
        guard let session else { return nil }
        guard let url = try? PonderURLNormalizer.normalizeInstanceURL(session.baseUrl) else { return nil }
        return SyncProtocol.createDataScope(baseURL: url, userId: session.user?.id)
    }

    func bootstrap() async {
        defer { isLoading = false }
        do {
            guard let raw = try KeychainStore.string(forKey: keychainSessionKey),
                  let data = raw.data(using: .utf8)
            else { return }
            let stored = try PonderJSON.decoder.decode(MobileSession.self, from: data)
            let baseURL = try PonderURLNormalizer.normalizeInstanceURL(stored.baseUrl)
            await client.update(baseURL: baseURL, token: stored.token, onUnauthorized: { [weak self] in
                Task { @MainActor in self?.clearLocalSession() }
            })
            session = stored
        } catch {
            lastError = error.localizedDescription
            clearLocalSession()
        }
    }

    func signIn(baseUrl: String, username: String, password: String) async throws {
        lastError = nil
        let url = try PonderURLNormalizer.normalizeInstanceURL(baseUrl)
        if url.scheme?.lowercased() == "http" {
            // Allowed with local networking; UI should already warn.
        }
        let deviceId = try DeviceId.getOrCreate()
        await client.update(baseURL: url, token: nil)
        let auth = try await client.login(LoginInput(username: username, password: password, deviceId: deviceId))
        guard auth.authenticated, let token = auth.sessionToken else {
            throw APIError(
                status: 400,
                code: nil,
                message: "Signed in, but the server did not return a mobile session. Make sure the server is updated to a version that supports app sign-in."
            )
        }
        let next = MobileSession(baseUrl: url.absoluteString, token: token, user: auth.user)
        try persist(next)
        await client.update(baseURL: url, token: token, onUnauthorized: { [weak self] in
            Task { @MainActor in self?.clearLocalSession() }
        })
        session = next
    }

    func signOut() async {
        if session != nil {
            try? await client.logout()
        }
        clearLocalSession()
    }

    private func persist(_ session: MobileSession) throws {
        let data = try PonderJSON.encoder.encode(session)
        guard let raw = String(data: data, encoding: .utf8) else { return }
        try KeychainStore.setString(raw, forKey: keychainSessionKey)
    }

    func clearLocalSession() {
        try? KeychainStore.delete(forKey: keychainSessionKey)
        session = nil
        Task { await client.update(baseURL: URL(string: "https://localhost")!, token: nil) }
    }
}
