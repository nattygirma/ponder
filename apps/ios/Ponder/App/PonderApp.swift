import SwiftUI

@main
struct PonderApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                .onOpenURL { url in
                    // Share Extension opens ponder://share after writing App Group payload.
                    guard url.scheme == "ponder" else { return }
                    // WorkspaceView consumes pending share payloads on appear / foreground.
                    NotificationCenter.default.post(name: .ponderShareReceived, object: nil)
                }
        }
    }
}

/// Simulator / debug helper. Enabled only when launch args provide credentials:
/// `-PonderAutoLoginURL` `-PonderAutoLoginUser` `-PonderAutoLoginPassword`
enum AutoLogin {
    @MainActor
    static func attemptIfConfigured(env: AppEnvironment) async {
        let args = ProcessInfo.processInfo.arguments
        func value(for flag: String) -> String? {
            guard let idx = args.firstIndex(of: flag), args.index(after: idx) < args.endIndex else {
                return nil
            }
            return args[args.index(after: idx)]
        }
        guard
            let base = value(for: "-PonderAutoLoginURL"),
            let user = value(for: "-PonderAutoLoginUser"),
            let password = value(for: "-PonderAutoLoginPassword")
        else { return }
        guard !env.session.isSignedIn else { return }
        do {
            try await env.session.signIn(baseUrl: base, username: user, password: password)
            await env.runSyncCycle()
        } catch {
            // Surface on login screen via next manual attempt; keep silent for automation logs.
            print("AutoLogin failed: \(error.localizedDescription)")
        }
    }
}

extension Notification.Name {
    static let ponderShareReceived = Notification.Name("ponderShareReceived")
    static let ponderResourcePress = Notification.Name("ponderResourcePress")
}
