import SwiftUI
import Pow

struct LoginView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var baseUrl = ""
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var submitting = false
    @State private var showHTTPWarning = false
    @State private var pendingHTTPLogin = false
    @State private var loginShake = 0

    private var canSubmit: Bool {
        !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
            && !submitting
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // Android login uses mint background #ecfdf5
            AppTheme.accentSoft
                .ignoresSafeArea()

            Link(destination: URL(string: "https://github.com/tianma-if/edgeever")!) {
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
                    .frame(width: 42, height: 42)
                    .background(AppTheme.card)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(AppTheme.border, lineWidth: 1))
            }
            .accessibilityLabel(env.preferences.t("GitHub repository", en: "GitHub repository", ja: "GitHub リポジトリ", pl: "Repozytorium GitHub"))
            .padding(.trailing, 18)
            .padding(.top, 18)
            .zIndex(2)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: 72)

                    // Header row: logo + title
                    HStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(AppTheme.accent)
                                .frame(width: 48, height: 48)
                            Image(systemName: "lock.fill")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Ponder")
                                .font(.system(size: 22, weight: .heavy))
                                .foregroundStyle(AppTheme.title)
                            Text(env.preferences.t("Connect your self-hosted notes", en: "Connect your self-hosted notes", ja: "セルフホストのノート空間に接続", pl: "Połącz się ze swoimi samodzielnie hostowanymi notatkami"))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.secondary)
                        }
                    }
                    .padding(.bottom, 28)

                    field(
                        env.preferences.t("Instance URL", en: "Instance URL", ja: "インスタンス URL", pl: "Adres URL instancji"),
                        placeholder: PonderPublicDemo.instanceURLString,
                        text: $baseUrl,
                        keyboard: .URL,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("Username", en: "Username", ja: "ユーザー名", pl: "Nazwa użytkownika"),
                        placeholder: "",
                        text: $username,
                        keyboard: .default,
                        secure: false
                    )
                    .padding(.bottom, 14)

                    field(
                        env.preferences.t("Password", en: "Password", ja: "パスワード", pl: "Hasło"),
                        placeholder: env.preferences.t("Initial password", en: "Initial password", ja: "初回ログイン用パスワード", pl: "Hasło początkowe"),
                        text: $password,
                        keyboard: .default,
                        secure: true
                    )
                    .padding(.bottom, 16)

                    if let error {
                        Text(error)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.danger)
                            .padding(.bottom, 10)
                            .transition(Motion.softFade)
                            .ponderErrorShake(on: error)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        HStack(spacing: 8) {
                            if submitting {
                                ProgressView().tint(.white)
                            }
                            Text(submitting
                                ? env.preferences.t("Signing in…", en: "Signing in…", ja: "ログイン中…", pl: "Logowanie…")
                                : env.preferences.t("Sign in", en: "Sign in", ja: "ログイン", pl: "Zaloguj się"))
                                .font(.system(size: 16, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .foregroundStyle(.white)
                        .background(canSubmit ? AppTheme.title : AppTheme.disabledFill)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)
                    .changeEffect(.shake, value: loginShake)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 40)
            }
        }
        .alert(env.preferences.t("Use HTTP?", en: "Use HTTP?", ja: "HTTP で接続しますか？", pl: "Użyć HTTP?"), isPresented: $showHTTPWarning) {
            Button(env.preferences.t("Continue", en: "Continue", ja: "続行", pl: "Kontynuuj"), role: .destructive) {
                pendingHTTPLogin = true
                Task { await submit(forceHTTP: true) }
            }
            Button(env.preferences.t("Cancel", en: "Cancel", ja: "キャンセル", pl: "Anuluj"), role: .cancel) {}
        } message: {
            Text(env.preferences.t(
                "HTTP does not encrypt credentials. Only use on trusted LAN instances.",
                en: "HTTP does not encrypt credentials. Only use on trusted LAN instances.",
                ja: "HTTP は資格情報を暗号化しません。信頼できる LAN 上の自前インスタンスにだけ使ってください。",
                pl: "HTTP nie szyfruje danych logowania. Używaj go tylko z instancjami w zaufanej sieci lokalnej."
            ))
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    private func field(
        _ title: String,
        placeholder: String,
        text: Binding<String>,
        keyboard: UIKeyboardType,
        secure: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(AppTheme.meta)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .font(.system(size: 15))
            .foregroundStyle(AppTheme.title)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
        }
    }

    private func submit(forceHTTP: Bool = false) async {
        error = nil
        let trimmed = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !forceHTTP && !pendingHTTPLogin {
            if let url = try? PonderURLNormalizer.normalizeInstanceURL(trimmed),
               url.scheme?.lowercased() == "http"
            {
                showHTTPWarning = true
                return
            }
        }
        pendingHTTPLogin = false
        submitting = true
        defer { submitting = false }
        do {
            try await env.session.signIn(baseUrl: trimmed, username: username, password: password)
            await env.runSyncCycle()
        } catch {
            withAnimation(Motion.chip) {
                self.error = error.localizedDescription
            }
            loginShake += 1
        }
    }
}
