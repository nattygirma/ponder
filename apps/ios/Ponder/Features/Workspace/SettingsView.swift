import SwiftUI

/// Android `WorkspaceSettingsView` parity: full-height profile content above the shared bottom navigation.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.colorScheme) private var colorScheme
    let onClose: () -> Void

    private enum RootTab: Hashable {
        case general
        case account
        case system
        // Extended (not on Android root Me, but reachable from system/account extras)
        case tags
        case tokens
        case devices
        case users
    }

    @State private var tab: RootTab?
    @State private var showLocalePicker = false
    @State private var copiedSystemInfo = false
    @State private var instanceHealth: InstanceHealth?
    @State private var instanceVersion: String?
    @State private var instanceLatencyMilliseconds: Int?
    @State private var instanceDiagnosticsFailed = false

    private var title: String {
        switch tab {
        case .general: return env.preferences.t("General", en: "General", pl: "Ogólne")
        case .account: return env.preferences.t("Account", en: "Account", pl: "Konto")
        case .system: return env.preferences.t("System info", en: "System info", pl: "Informacje o systemie")
        case .tags: return env.preferences.t("Tags", en: "Tags", pl: "Tagi")
        case .tokens: return "API Token"
        case .devices: return env.preferences.t("Devices", en: "Devices", pl: "Urządzenia")
        case .users: return env.preferences.t("Users", en: "Users", pl: "Użytkownicy")
        case nil: return env.preferences.t("Me", en: "Me", pl: "Profil")
        }
    }

    private var headerIcon: String {
        switch tab {
        case .general: return "slider.horizontal.3"
        case .account: return "shield.checkered"
        case .system: return "info.circle"
        case .tags: return "tag"
        case .tokens: return "key"
        case .devices: return "iphone"
        case .users: return "person.2"
        case nil: return "person"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            settingsHeader
            ScrollView {
                Group {
                    if let tab {
                        detailContent(tab)
                            .transition(.opacity.combined(with: .move(edge: .trailing)))
                    } else {
                        rootMenu
                            .transition(.opacity)
                    }
                }
                .padding(16)
                .padding(.bottom, 96)
                .animation(Motion.listContent, value: tab)
            }
            .background(AppTheme.background)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .preferredColorScheme(env.preferences.colorScheme)
        .task(id: tab) {
            guard tab == .system else { return }
            await loadInstanceDiagnostics()
        }
    }

    // MARK: - Header (Android settingsHeader)

    private var settingsHeader: some View {
        HStack(spacing: 0) {
            Button {
                if tab != nil {
                    withAnimation(Motion.chip) { tab = nil }
                } else {
                    onClose()
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.secondary)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Image(systemName: headerIcon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                Text(title)
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 4)

            Button {
                withAnimation(Motion.chip) {
                    env.preferences.theme = resolvedDarkMode ? "light" : "dark"
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: resolvedDarkMode ? "sun.max" : "moon")
                        .font(.system(size: 16, weight: .semibold))
                    Text(themeToggleLabel)
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(1)
                }
                .foregroundStyle(AppTheme.slate)
                .padding(.horizontal, 8)
                .frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 56)
        .background(AppTheme.card)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
    }

    private var themeToggleLabel: String {
        // Android shows the *action* text: switch to light when dark, else switch to dark
        if resolvedDarkMode {
            return env.preferences.t("Light mode", en: "Light mode", pl: "Tryb jasny")
        }
        return env.preferences.t("Dark mode", en: "Dark mode", pl: "Tryb ciemny")
    }

    private var resolvedDarkMode: Bool {
        env.preferences.theme == "dark" || (env.preferences.theme == "system" && colorScheme == .dark)
    }

    // MARK: - Root Me menu (Android activeTab === null)

    private var rootMenu: some View {
        VStack(spacing: 16) {
            // Card 1: general + account
            settingsMenuCard {
                menuRow(
                    icon: "slider.horizontal.3",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("General", en: "General", pl: "Ogólne"),
                    showBorder: false
                ) {
                    withAnimation(Motion.chip) { tab = .general }
                }
                menuRow(
                    icon: "shield.checkered",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("Account", en: "Account", pl: "Konto"),
                    showBorder: true
                ) {
                    withAnimation(Motion.chip) { tab = .account }
                }
            }

            // Card 2: system + feedback
            settingsMenuCard {
                menuRow(
                    icon: "info.circle",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("System info", en: "System info", pl: "Informacje o systemie"),
                    subtitle: env.preferences.t(
                        "View version and runtime info.",
                        en: "View version and runtime info.",
                        pl: "Wyświetl informacje o wersji i środowisku uruchomieniowym."
                    ),
                    showBorder: false
                ) {
                    withAnimation(Motion.chip) { tab = .system }
                }
                menuRow(
                    icon: "bubble.left.and.bubble.right",
                    iconTint: AppTheme.secondary,
                    iconBg: AppTheme.searchFill,
                    title: env.preferences.t("Feedback", en: "Feedback", pl: "Opinia"),
                    subtitle: env.preferences.t(
                        "Report issues or suggest features",
                        en: "Report issues or suggest features",
                        pl: "Zgłoś problem lub zaproponuj funkcję"
                    ),
                    trailing: .external,
                    showBorder: true
                ) {
                    if let url = feedbackURL { UIApplication.shared.open(url) }
                }
            }
        }
    }

    private enum TrailingKind { case chevron, external }

    private func settingsMenuCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func menuRow(
        icon: String,
        iconTint: Color,
        iconBg: Color,
        title: String,
        subtitle: String? = nil,
        trailing: TrailingKind = .chevron,
        showBorder: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(iconBg)
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(iconTint)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.secondary)
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: trailing == .external ? "arrow.up.right" : "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if showBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
                    .padding(.leading, 16)
            }
        }
    }

    // MARK: - Detail tabs

    @ViewBuilder
    private func detailContent(_ tab: RootTab) -> some View {
        switch tab {
        case .general:
            generalContent
        case .account:
            accountContent
        case .system:
            systemContent
        case .tags:
            TagsManagementView()
        case .tokens:
            ApiTokensView()
        case .devices:
            DevicesView()
        case .users:
            UsersManagementView()
        }
    }

    private var generalContent: some View {
        VStack(spacing: 16) {
            settingsGroup(
                title: env.preferences.t("Preferences", en: "Preferences", pl: "Preferencje"),
                icon: "photo"
            ) {
                preferenceBlock(
                    title: env.preferences.t("Language", en: "Language", pl: "Język"),
                    description: env.preferences.t("Switch the product UI language.", en: "Switch the product UI language.", pl: "Zmień język interfejsu aplikacji.")
                ) {
                    Menu {
                        Button(env.preferences.t("System", en: "System", ja: "システムに合わせる", pl: "Systemowy")) { env.preferences.localeCode = "system" }
                        Button("English") { env.preferences.localeCode = "en-US" }
                        Button("日本語") { env.preferences.localeCode = "ja" }
                        Button("Polski") { env.preferences.localeCode = "pl" }
                    } label: {
                        HStack {
                            Text(localeLabel)
                                .font(.system(size: 14))
                                .foregroundStyle(AppTheme.title)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8).stroke(AppTheme.border, lineWidth: 1)
                        )
                    }
                }

                preferenceBlock(
                    title: env.preferences.t("Compress note images", en: "Compress note images", pl: "Kompresuj obrazy w notatkach"),
                    description: env.preferences.t(
                        "Compress large images to WebP (max edge 2560) before upload to save storage and bandwidth.",
                        en: "Compress large images to WebP (max edge 2560) before upload to save storage and bandwidth.",
                        pl: "Przed przesłaniem kompresuj duże obrazy do WebP (najdłuższy bok 2560), aby oszczędzać miejsce i transfer."
                    ),
                    showTopBorder: true
                ) {
                    Toggle("", isOn: Bindable(env.preferences).useCompression)
                        .labelsHidden()
                        .tint(AppTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                preferenceBlock(
                    title: env.preferences.t("Show notes from sub-notebooks", en: "Show notes from sub-notebooks", ja: "サブノートブックのノートを表示", pl: "Pokazuj notatki z podnotatników"),
                    showTopBorder: true
                ) {
                    Toggle("", isOn: Bindable(env.preferences).showDescendantNotes)
                        .labelsHidden()
                        .tint(AppTheme.accent)
                        .accessibilityLabel(env.preferences.t(
                            "Show notes from sub-notebooks in parent notebooks",
                            en: "Show notes from sub-notebooks in parent notebooks",
                            ja: "親ノートブックにサブノートブックのノートを表示する",
                            pl: "Pokazuj notatki z podnotatników w notatnikach nadrzędnych"
                        ))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                // List density lives in list-options sheet (Android NotesActionsModal), not here.
            }
        }
    }

    private var accountContent: some View {
        VStack(spacing: 16) {
            // Account summary card
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(AppTheme.accentSoft).frame(width: 40, height: 40)
                    Image(systemName: "person")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(AppTheme.accentStrong)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("Current account", en: "Current account", pl: "Bieżące konto"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppTheme.secondary)
                    Text(env.session.session?.user?.displayName ?? env.session.session?.user?.username ?? "—")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    let role = env.session.session?.user?.role == "owner"
                        ? env.preferences.t("Owner", en: "Owner", pl: "Właściciel")
                        : env.preferences.t("Member", en: "Member", pl: "Członek")
                    Text("@\(env.session.session?.user?.username ?? "—") · \(role)")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .padding(.top, 1)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )

            // Change password panel (Android AccountSecurityPanel)
            AccountPasswordPanel()

            // Extended links (tokens/devices/users/tags) — compact rows, not on Android root Me
            settingsMenuCard {
                menuRow(icon: "iphone", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: env.preferences.t("Devices", en: "Devices", pl: "Urządzenia"), showBorder: false) {
                    withAnimation(Motion.chip) { tab = .devices }
                }
                menuRow(icon: "key", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: "API Token", showBorder: true) {
                    withAnimation(Motion.chip) { tab = .tokens }
                }
                menuRow(icon: "tag", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: env.preferences.t("Tags", en: "Tags", pl: "Tagi"), showBorder: true) {
                    withAnimation(Motion.chip) { tab = .tags }
                }
                if env.session.session?.user?.role == "owner" {
                    menuRow(icon: "person.2", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                            title: env.preferences.t("Users", en: "Users", pl: "Użytkownicy"), showBorder: true) {
                        withAnimation(Motion.chip) { tab = .users }
                    }
                }
            }

            // Logout card
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    Task {
                        await env.session.signOut()
                        onClose()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 15, weight: .bold))
                        Text(env.preferences.t("Sign out", en: "Sign out", pl: "Wyloguj się"))
                            .font(.system(size: 14, weight: .heavy))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 40)
                    .background(AppTheme.dangerAction)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(AppTheme.dangerSurface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.dangerBorder, lineWidth: 1)
            )
        }
    }

    private var systemContent: some View {
        VStack(spacing: 16) {
            settingsGroup(title: env.preferences.t("System info", en: "System info", pl: "Informacje o systemie"), icon: "info.circle") {
                Button {
                    UIPasteboard.general.string = systemInfoText
                    copiedSystemInfo = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { copiedSystemInfo = false }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: copiedSystemInfo ? "checkmark.shield" : "doc.on.doc")
                        Text(copiedSystemInfo
                            ? env.preferences.t("Copied", en: "Copied", pl: "Skopiowano")
                            : env.preferences.t("Copy info", en: "Copy info", pl: "Kopiuj informacje"))
                            .font(.system(size: 14, weight: .bold))
                        Spacer()
                    }
                    .foregroundStyle(copiedSystemInfo ? AppTheme.accentStrong : AppTheme.title)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }

            systemInfoGroup(
                title: env.preferences.t("Cloud instance", en: "Cloud instance", pl: "Instancja w chmurze"),
                description: env.preferences.t("Version and deployment environment for the connected instance.", en: "Version and deployment environment for the connected instance.", pl: "Wersja i środowisko wdrożenia połączonej instancji."),
                icon: "cloud",
                items: cloudSystemInfoItems,
                notice: clientAheadOfInstanceNotice
            )

            systemInfoGroup(
                title: env.preferences.t("Current client", en: "Current client", pl: "Bieżący klient"),
                description: env.preferences.t("The Ponder app and runtime environment on this device.", en: "The Ponder app and runtime environment on this device.", pl: "Aplikacja Ponder i środowisko uruchomieniowe na tym urządzeniu."),
                icon: "iphone",
                items: clientSystemInfoItems
            )

            systemInfoGroup(
                title: env.preferences.t("Connection and sync", en: "Connection and sync", pl: "Połączenie i synchronizacja"),
                description: env.preferences.t("Connection and local sync queue status.", en: "Connection and local sync queue status.", pl: "Stan połączenia i lokalnej kolejki synchronizacji."),
                icon: "arrow.triangle.2.circlepath",
                items: connectionSystemInfoItems
            )

            Button {
                Task { await env.runSyncCycle() }
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text(env.preferences.t("Sync now", en: "Sync now", pl: "Synchronizuj teraz"))
                        .font(.system(size: 14, weight: .bold))
                    if env.isSyncing { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .foregroundStyle(AppTheme.title)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
            }
            .buttonStyle(.plain)

            if let err = env.lastSyncError {
                Text(err)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - Building blocks

    private var localeLabel: String {
        switch env.preferences.localeCode {
        case "en-US": return "English"
        case "ja": return "日本語"
        case "pl": return "Polski"
        default: return env.preferences.t("System", en: "System", ja: "システムに合わせる", pl: "Systemowy")
        }
    }

    private var clientAheadOfInstanceNotice: String? {
        let clientVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        guard let clientVersion, let instanceVersion, Self.isClient(clientVersion, aheadOfInstance: instanceVersion) else {
            return nil
        }
        switch instanceHealth?.runtime {
        case "cloudflare-workers":
            return env.preferences.t(
                "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run the Update deployed Ponder workflow.",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run the Update deployed Ponder workflow.",
                pl: "Ten klient jest nowszy niż połączona instancja w chmurze. Możesz poczekać na codzienną automatyczną aktualizację instancji lub uruchomić workflow Update deployed Ponder."
            )
        case "self-hosted-bun":
            return env.preferences.t(
                "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run ./update.sh in the install directory (default ~/ponder).",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run ./update.sh in the install directory (default ~/ponder).",
                pl: "Ten klient jest nowszy niż połączona instancja w chmurze. Możesz poczekać na codzienną automatyczną aktualizację instancji lub uruchomić ./update.sh w katalogu instalacji (domyślnie ~/ponder)."
            )
        default:
            return env.preferences.t(
                "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or update the instance manually.",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or update the instance manually.",
                pl: "Ten klient jest nowszy niż połączona instancja w chmurze. Możesz poczekać na codzienną automatyczną aktualizację instancji lub zaktualizować ją ręcznie."
            )
        }
    }

    private static func isClient(_ clientVersion: String, aheadOfInstance instanceVersion: String) -> Bool {
        func core(_ value: String) -> [Int]? {
            let pattern = #"^v?(\d+)\.(\d+)\.(\d+)"#
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
            let range = NSRange(value.startIndex..., in: value)
            guard let match = regex.firstMatch(in: value, range: range) else { return nil }
            let numbers = (1...3).compactMap { index -> Int? in
                guard let part = Range(match.range(at: index), in: value) else { return nil }
                return Int(value[part])
            }
            return numbers.count == 3 ? numbers : nil
        }
        guard let client = core(clientVersion), let instance = core(instanceVersion) else { return false }
        for index in 0..<3 where client[index] != instance[index] {
            return client[index] > instance[index]
        }
        return false
    }

    private struct SystemInfoItem {
        let label: String
        let value: String
        var localOnly = false
    }

    private var currentClientDisplaySize: String {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let screen = scene?.screen ?? UIScreen.main
        let screenWidth = Int(screen.bounds.width.rounded())
        let screenHeight = Int(screen.bounds.height.rounded())
        guard screenWidth > 0, screenHeight > 0, screen.scale > 0 else {
            return env.preferences.t("Unknown", en: "Unknown", pl: "Nieznane")
        }
        let screenText = "\(screenWidth)×\(screenHeight)"
        let dpr = Self.formatDevicePixelRatio(screen.scale)
        return env.preferences.t(
            "\(screenText) @\(dpr)x",
            en: "\(screenText) @\(dpr)x",
            ja: "\(screenText) @\(dpr)x",
            pl: "\(screenText) @\(dpr)x"
        )
    }

    private static func formatDevicePixelRatio(_ value: CGFloat) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == CGFloat(Int(rounded)) {
            return String(Int(rounded))
        }
        return String(format: "%g", Double(rounded))
    }

    private var currentDeviceModel: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) {
                String(cString: $0)
            }
        }
        let trimmed = machine.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? env.preferences.t("Unknown", en: "Unknown", pl: "Nieznane") : trimmed
    }

    private var clientSystemInfoItems: [SystemInfoItem] {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        let language = env.preferences.localeCode == "system"
            ? "\(env.preferences.resolvedLocale.identifier) (\(env.preferences.t("Follow system", en: "Follow system", pl: "Zgodnie z systemem")))"
            : env.preferences.resolvedLocale.identifier
        return [
            SystemInfoItem(label: env.preferences.t("Version", en: "Version", pl: "Wersja"), value: "v\(version)"),
            SystemInfoItem(label: env.preferences.t("Build", en: "Build", pl: "Kompilacja"), value: build),
            SystemInfoItem(label: env.preferences.t("Client", en: "Client", pl: "Klient"), value: env.preferences.t("Mobile app", en: "Mobile app", pl: "Aplikacja mobilna")),
            SystemInfoItem(label: env.preferences.t("System", en: "System", pl: "Systemowy"), value: "iOS"),
            SystemInfoItem(label: env.preferences.t("System version", en: "System version", pl: "Wersja systemu"), value: UIDevice.current.systemVersion),
            SystemInfoItem(
                label: env.preferences.t("Device model", en: "Device model", ja: "機種", pl: "Model urządzenia"),
                value: currentDeviceModel
            ),
            SystemInfoItem(
                label: env.preferences.t("Screen resolution", en: "Screen resolution", ja: "画面解像度", pl: "Rozdzielczość ekranu"),
                value: currentClientDisplaySize
            ),
            SystemInfoItem(label: env.preferences.t("Language", en: "Language", pl: "Język"), value: language),
            SystemInfoItem(label: env.preferences.t("Time zone", en: "Time zone", pl: "Strefa czasowa"), value: TimeZone.current.identifier),
            SystemInfoItem(label: env.preferences.t("Mode", en: "Mode", pl: "Tryb"), value: env.preferences.t("Native SwiftUI app", en: "Native SwiftUI app", pl: "Natywna aplikacja SwiftUI")),
        ]
    }

    private var cloudSystemInfoItems: [SystemInfoItem] {
        var items: [SystemInfoItem] = []
        if let instanceURL = env.session.session?.baseUrl, !instanceURL.isEmpty {
            items.append(SystemInfoItem(
                label: env.preferences.t("Instance URL", en: "Instance URL", ja: "インスタンス URL", pl: "Adres URL instancji"),
                value: instanceURL,
                localOnly: true
            ))
        }
        items.append(contentsOf: [
            SystemInfoItem(
                label: env.preferences.t("Instance version", en: "Instance version", pl: "Wersja instancji"),
                value: instanceVersion.map { "v\($0.replacingOccurrences(of: "^v", with: "", options: .regularExpression))" } ?? unknownSystemInfoValue
            ),
            SystemInfoItem(label: env.preferences.t("Instance build", en: "Instance build", pl: "Kompilacja instancji"), value: instanceHealth?.build ?? unknownSystemInfoValue),
            SystemInfoItem(
                label: env.preferences.t("Instance deployment time", en: "Instance deployment time", ja: "インスタンスのデプロイ時刻", pl: "Czas wdrożenia instancji"),
                value: deploymentVersionTimeLabel(instanceHealth?.deploymentVersionCreatedAt)
            ),
            SystemInfoItem(label: env.preferences.t("Database version", en: "Database version", pl: "Wersja bazy danych"), value: instanceHealth?.migration ?? unknownSystemInfoValue),
            SystemInfoItem(label: env.preferences.t("Database backend", en: "Database backend", pl: "Backend bazy danych"), value: databaseBackendLabel(instanceHealth?.storage?.database)),
            SystemInfoItem(label: env.preferences.t("New upload object storage", en: "New upload object storage", pl: "Magazyn obiektów dla nowych przesyłanych plików"), value: objectStorageLabel(instanceHealth)),
        ])
        if instanceHealth?.objectStorageProvider == "s3" {
            items.append(SystemInfoItem(
                label: env.preferences.t("Existing attachments", en: "Existing attachments", pl: "Istniejące załączniki"),
                value: env.preferences.t("Read from original storage", en: "Read from original storage", pl: "Odczyt z pierwotnego magazynu")
            ))
        }
        items.append(SystemInfoItem(
            label: env.preferences.t("Deployment platform", en: "Deployment platform", pl: "Platforma wdrożenia"),
            value: deploymentPlatformLabel(instanceHealth?.runtime)
        ))
        if instanceHealth?.runtime == "self-hosted-bun" {
            items.append(SystemInfoItem(
                label: env.preferences.t("Container image source", en: "Container image source", pl: "Źródło obrazu kontenera"),
                value: containerImageSourceLabel(instanceHealth?.containerImageSource)
            ))
        }
        return items
    }

    private var connectionSystemInfoItems: [SystemInfoItem] {
        let queueItems = env.session.dataScope.flatMap { try? env.outbox.listItems(scope: $0) } ?? []
        let pending = queueItems.filter { $0.status == .pending || $0.status == .syncing }.count
        let failed = queueItems.filter { $0.status == .error || $0.status == .conflict }.count
        let connection = instanceHealth != nil
            ? env.preferences.t("Connected", en: "Connected", pl: "Połączono")
            : instanceDiagnosticsFailed
                ? env.preferences.t("Connection failed", en: "Connection failed", pl: "Błąd połączenia")
                : env.preferences.t("Checking", en: "Checking", pl: "Sprawdzanie")
        return [
            SystemInfoItem(label: env.preferences.t("Instance connection", en: "Instance connection", pl: "Połączenie z instancją"), value: connection),
            SystemInfoItem(
                label: env.preferences.t("Health check time", en: "Health check time", ja: "ヘルスチェック時間", pl: "Czas sprawdzenia stanu"),
                value: instanceLatencyMilliseconds.map { "\($0) ms" } ?? unknownSystemInfoValue
            ),
            SystemInfoItem(label: env.preferences.t("Pending sync", en: "Pending sync", pl: "Oczekuje na synchronizację"), value: String(pending)),
            SystemInfoItem(label: env.preferences.t("Failed or conflicted", en: "Failed or conflicted", pl: "Błędy lub konflikty"), value: String(failed)),
        ]
    }

    private var unknownSystemInfoValue: String {
        env.preferences.t("Unknown", en: "Unknown", pl: "Nieznane")
    }

    private func deploymentVersionTimeLabel(_ timestamp: String?) -> String {
        guard let timestamp else { return unknownSystemInfoValue }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = parser.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
        guard let parsed else { return unknownSystemInfoValue }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: parsed)
    }

    private func databaseBackendLabel(_ backend: String?) -> String {
        switch backend {
        case "d1": return "D1"
        case "sqlite": return "SQLite"
        case let value?: return value
        case nil: return unknownSystemInfoValue
        }
    }

    private func objectStorageLabel(_ health: InstanceHealth?) -> String {
        if health?.objectStorageProvider == "s3" {
            return env.preferences.t("Third-party S3-compatible OSS", en: "Third-party S3-compatible OSS", pl: "Zewnętrzny magazyn OSS zgodny z S3")
        }
        guard health?.objectStorageProvider == "builtin" else { return unknownSystemInfoValue }
        switch health?.storage?.resources {
        case "r2": return env.preferences.t("Built-in R2", en: "Built-in R2", pl: "Wbudowany R2")
        case "filesystem": return env.preferences.t("Local filesystem", en: "Local filesystem", pl: "Lokalny system plików")
        case "s3": return env.preferences.t("Instance-provided S3-compatible storage", en: "Instance-provided S3-compatible storage", pl: "Magazyn zgodny z S3 dostarczany przez instancję")
        default: return unknownSystemInfoValue
        }
    }

    private func deploymentPlatformLabel(_ runtime: String?) -> String {
        switch runtime {
        case "cloudflare-workers": return "Cloudflare"
        case "self-hosted-bun": return "Docker"
        default: return unknownSystemInfoValue
        }
    }

    private func containerImageSourceLabel(_ source: String?) -> String {
        switch source {
        case "official-ghcr": return "GitHub Container Registry (GHCR)"
        case "official-cn-mirror": return env.preferences.t("Official mainland China mirror", en: "Official mainland China mirror", pl: "Oficjalny mirror dla Chin kontynentalnych")
        case "custom": return env.preferences.t("Custom image", en: "Custom image", pl: "Własny obraz")
        default: return unknownSystemInfoValue
        }
    }

    private var systemInfoText: String {
        systemInfoText(includeLocalOnly: true)
    }

    private func systemInfoText(includeLocalOnly: Bool) -> String {
        let keep: (SystemInfoItem) -> Bool = includeLocalOnly ? { _ in true } : { !$0.localOnly }
        return [
            systemInfoTextSection(env.preferences.t("Cloud instance", en: "Cloud instance", pl: "Instancja w chmurze"), items: cloudSystemInfoItems.filter(keep)),
            systemInfoTextSection(env.preferences.t("Current client", en: "Current client", pl: "Bieżący klient"), items: clientSystemInfoItems.filter(keep)),
            systemInfoTextSection(env.preferences.t("Connection and sync", en: "Connection and sync", pl: "Połączenie i synchronizacja"), items: connectionSystemInfoItems.filter(keep)),
        ].joined(separator: "\n\n")
    }

    private func systemInfoTextSection(_ title: String, items: [SystemInfoItem]) -> String {
        ([title] + items.map { "\($0.label): \($0.value)" }).joined(separator: "\n")
    }

    private func loadInstanceDiagnostics() async {
        guard env.session.isSignedIn else {
            instanceDiagnosticsFailed = true
            return
        }
        instanceDiagnosticsFailed = false
        let startedAt = Date()
        do {
            async let health = env.session.client.getInstanceHealth()
            async let release = env.session.client.getInstanceRelease()
            let (resolvedHealth, resolvedRelease) = try await (health, release)
            instanceHealth = resolvedHealth
            instanceVersion = resolvedRelease.version
            instanceLatencyMilliseconds = max(0, Int(Date().timeIntervalSince(startedAt) * 1_000))
        } catch {
            instanceHealth = nil
            instanceVersion = nil
            instanceLatencyMilliseconds = nil
            instanceDiagnosticsFailed = true
        }
    }

    private var feedbackURL: URL? {
        let english = env.preferences.isEnglish
        let heading = english ? "Feedback" : "Feedback"
        let prompt = english
            ? "Describe the problem, steps to reproduce it, or the feature you would like to see."
            : "Describe the problem, the steps to reproduce it, or the feature you would like."
        let privacy = english
            ? "GitHub Issues are public. Do not include passwords, tokens, instance URLs, or private note content."
            : "GitHub Issues are public. Do not include passwords, tokens, instance addresses, or private notes."
        let infoHeading = english ? "System information" : "System information"
        let notice = english
            ? "The following information was generated by Ponder to help diagnose the issue."
            : "Ponder generated the information below to help diagnose the problem."
        let info = systemInfoText(includeLocalOnly: false)
        let body = """
        ## \(heading)

        \(prompt)

        > \(privacy)

        ## \(infoHeading)

        \(notice)

        ```text
        \(info)
        ```
        """
        var components = URLComponents(string: "https://github.com/tianma-if/edgeever/issues/new")
        components?.queryItems = [
            URLQueryItem(name: "title", value: english ? "[Feedback] " : "[Feedback] "),
            URLQueryItem(name: "body", value: body),
            URLQueryItem(name: "system-info", value: info),
            URLQueryItem(name: "client", value: "iOS"),
        ]
        return components?.url
    }

    private func settingsGroup<Content: View>(
        title: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                Text(title)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
            }
            .padding(16)
            content()
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
            )
    }

    private func systemInfoGroup(
        title: String,
        description: String,
        icon: String,
        items: [SystemInfoItem],
        notice: String? = nil
    ) -> some View {
        settingsGroup(title: title, icon: icon) {
            Text(description)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

            if let notice {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 11, weight: .semibold))
                    Text(notice)
                        .font(.system(size: 11))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(AppTheme.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }

            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                infoRow(item.label, item.value, showBorder: true)
            }
        }
    }

    private func preferenceBlock<Content: View>(
        title: String,
        description: String? = nil,
        showTopBorder: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AppTheme.title)
                if let description {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) {
            if showTopBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
            }
        }
    }

    private func infoRow(_ title: String, _ value: String, showBorder: Bool) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.title)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(16)
        .overlay(alignment: .top) {
            if showBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
            }
        }
    }
}

// MARK: - Password panel (Android AccountSecurityPanel)
