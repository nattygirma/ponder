import SwiftUI
import UIKit

/// Wrapper so `fullScreenCover(item:)` can present edit for a memo id.
struct EditingMemoRoute: Identifiable, Hashable {
    let id: String
    let initialFocus: MemoEditInitialFocus
}

private struct ShareImageMemoRoute: Hashable {
    let memoId: String
}

private struct SelectionSharePayload: Identifiable {
    let id = UUID()
    let message: String
    let url: URL
}

/// Keep each create editor's input fixed until its save and cover dismissal finish.
struct MemoCreatePresentation {
    struct Request: Identifiable {
        let id = UUID()
        let seed: CreateMemoSeed?
        let sharedImages: [ShareHandoffStore.SharedImage]

        init(seed: CreateMemoSeed?, sharedImages: [ShareHandoffStore.SharedImage] = []) {
            self.seed = seed
            self.sharedImages = sharedImages
        }
    }

    private(set) var current: Request?
    private(set) var pending: [Request] = []
    var shouldFinishForIncomingShare: Bool { !pending.isEmpty }

    /// Returns true only when a new cover can be presented immediately.
    mutating func open(_ request: Request) -> Bool {
        guard current == nil else {
            pending.append(request)
            return false
        }
        current = request
        return true
    }

    /// Called by fullScreenCover's onDismiss, after the old editor has gone away.
    mutating func didDismiss() -> Bool {
        current = pending.isEmpty ? nil : pending.removeFirst()
        return current != nil
    }
}

struct WorkspaceView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var store = WorkspaceStore()
    @State private var path = NavigationPath()
    @State private var showSettings = false
    @State private var showNewNote = false
    @State private var createPresentation = MemoCreatePresentation()
    @State private var showCreateChoice = false
    @State private var showTemplatePicker = false
    @State private var createLongPressConsumed = false
    @State private var showMoveSheet = false
    @State private var showSelectionMore = false
    @State private var pendingMemoShare: MemoSummary?
    @State private var pendingImageShareMemoId: String?
    @State private var selectionSharePayload: SelectionSharePayload?
    @State private var conflictItem: OutboxItem?
    /// Edit is presented from the workspace root — more reliable than cover on a pushed detail page.
    @State private var editingMemo: EditingMemoRoute?
    @State private var incomingClipURL: URL?
    @State private var isImportingShare = false
    @State private var shareImportAlert: ShareImportAlert?

    /// Android SafeAreaView edges=[top,left,right] — bottom chrome owns home indicator.
    private var showsBottomChrome: Bool {
        store.selectionMode || path.isEmpty
    }

    /// Solid chrome height = nav band + home-indicator. Create button sits *inside* the band
    /// (below the top separator), so list padding must not invent a second empty strip.
    private var bottomChromeHeight: CGFloat {
        MobileUIMetrics.bottomChromeHeight
    }

    var body: some View {
        NavigationStack(path: $path) {
            // List pads the solid white chrome height; create button lives inside the tab bar under the separator.
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    if showSettings {
                        SettingsView(onClose: { showSettings = false })
                    } else {
                        syncBanner
                        listHeader
                        NotesListView(
                            store: store,
                            path: $path,
                            onCreateNote: { openCreateNote() },
                            onCreateFromTemplate: { openCreateFromTemplate() },
                            onCreateNotebook: {
                                store.startCreatingNotebook = true
                                store.showNotebookPicker = true
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .background(AppTheme.background)
                .padding(.bottom, showsBottomChrome ? bottomChromeHeight : 0)

                if store.selectionMode {
                    selectionBar
                } else if path.isEmpty {
                    bottomNav
                }
            }
            .ignoresSafeArea(.container, edges: .bottom)
            .navigationBarHidden(true)
            .navigationDestination(for: String.self) { memoId in
                memoDetail(for: memoId)
            }
            .navigationDestination(for: ShareImageMemoRoute.self) { route in
                memoDetail(for: route.memoId, shareImage: true)
            }
            // Android CreateMemoModal is fullScreen — not a half sheet / Form.
            .fullScreenCover(isPresented: $showNewNote, onDismiss: {
                showNewNote = createPresentation.didDismiss()
                store.reload(env: env)
            }) {
                MemoEditView(
                    mode: .create(
                        notebookId: store.selectedNotebookId ?? store.notebooks.first?.id ?? "",
                        seed: createPresentation.current?.seed
                    ),
                    initialSharedImages: createPresentation.current?.sharedImages ?? [],
                    finishForIncomingShare: createPresentation.shouldFinishForIncomingShare,
                    onCreateFinished: { _ in
                        store.reload(env: env)
                    }
                )
                .id(createPresentation.current?.id)
            }
            .sheet(isPresented: $showCreateChoice) {
                CreateChoiceSheet(
                    canCreate: !store.notebooks.isEmpty,
                    onBlank: { openCreateNote() },
                    onTemplate: { openCreateFromTemplate() }
                )
            }
            .sheet(isPresented: $showTemplatePicker) {
                TemplatePickerSheet { seed in
                    openCreateNote(seed: seed)
                }
            }
            // Edit cover on workspace root; underlay is list (detail popped once cover is presented).
            .fullScreenCover(item: $editingMemo) { route in
                MemoEditView(
                    mode: .edit(memoId: route.id),
                    initialFocus: route.initialFocus,
                    onLeaveToList: {
                        // Pop detail first (no animation) while cover still covers the stack,
                        // then dismiss the cover so the user only ever sees the list.
                        store.reload(env: env)
                        var t = Transaction()
                        t.disablesAnimations = true
                        withTransaction(t) {
                            path = NavigationPath()
                        }
                        editingMemo = nil
                    }
                )
            }
            .sheet(isPresented: $store.showNotebookPicker) {
                NotebookPickerSheet(store: store)
            }
            .sheet(isPresented: $store.showActions) {
                ListActionsSheet(store: store)
            }
            .sheet(isPresented: $store.showTagFilterPicker) {
                MemoTagPickerSheet(
                    selectedTags: store.selectedTag.map { [$0] } ?? [],
                    allowCreate: false,
                    maxSelections: 1,
                    closeOnSelection: true,
                    title: "Filter by tag",
                    titleEN: "Filter by tag",
                    titlePL: "Filtruj według tagu"
                ) { tags in
                    store.selectTag(tags.first)
                    store.reload(env: env)
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showMoveSheet) {
                MoveNotebookSheet(notebooks: store.notebooks) { notebookId in
                    Task {
                        await store.moveSelection(env: env, notebookId: notebookId)
                        showMoveSheet = false
                    }
                }
            }
            .sheet(isPresented: $showSelectionMore, onDismiss: {
                if let memo = pendingMemoShare {
                    pendingMemoShare = nil
                    Task { await shareSelectedMemo(memo) }
                    return
                }
                guard let memoId = pendingImageShareMemoId else { return }
                pendingImageShareMemoId = nil
                store.clearSelection()
                path.append(ShareImageMemoRoute(memoId: memoId))
            }) {
                SelectionMoreSheet(
                    store: store,
                    onShare: { memo in pendingMemoShare = memo },
                    onShareImage: { memo in pendingImageShareMemoId = memo.id }
                )
                    .presentationDetents([.height(390), .medium])
                    .presentationDragIndicator(.hidden)
            }
            .sheet(item: $selectionSharePayload) { payload in
                ActivityShareView(items: [payload.message, payload.url]) { _, _, error in
                    if let error {
                        shareImportAlert = ShareImportAlert(
                            title: env.preferences.t("Share failed", en: "Share failed", pl: "Udostępnianie nie powiodło się"),
                            message: error.localizedDescription
                        )
                    }
                    selectionSharePayload = nil
                }
            }
            .sheet(item: $conflictItem) { item in
                ConflictResolutionView(item: item) {
                    conflictItem = nil
                    store.reload(env: env)
                }
            }
            .onAppear {
                store.reload(env: env)
                consumeShare()
                detectConflicts()
            }
            .onReceive(NotificationCenter.default.publisher(for: .ponderShareReceived)) { _ in
                consumeShare()
            }
            .onChange(of: env.session.session?.token) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.isSyncing) { wasSyncing, isSyncing in
                // Refresh list when a background/bootstrap sync finishes.
                if wasSyncing && !isSyncing {
                    store.reload(env: env)
                }
            }
            // Android invalidates the memo list on each bootstrap batch so the UI
            // can show progressive counts / partial notes during first login.
            .onChange(of: env.bootstrapProgress?.loadedCount) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.bootstrapProgress?.totalCount) { _, _ in
                store.reload(env: env)
            }
            .onChange(of: env.preferences.showDescendantNotes) { _, _ in
                store.reload(env: env)
            }
            .refreshable {
                await env.runSyncCycle(force: true)
                store.reload(env: env)
                detectConflicts()
            }
            .overlay {
                if isImportingShare {
                    ZStack {
                        Color.black.opacity(0.34).ignoresSafeArea()
                        VStack(spacing: 12) {
                            ProgressView()
                                .controlSize(.large)
                                .tint(AppTheme.accent)
                            Text(env.preferences.t("Clipping article", en: "Clipping article", ja: "記事を取り込んでいます", pl: "Przechwytywanie artykułu"))
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(AppTheme.title)
                            Text(env.preferences.t("Extracting the title, body, and image links…", en: "Extracting the title, body, and image links…", ja: "タイトル、本文、画像リンクを抽出しています…", pl: "Wyodrębnianie tytułu, treści i linków do obrazów…"))
                                .font(.system(size: 13))
                                .foregroundStyle(AppTheme.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding(24)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                        if let incomingClipURL {
                            WebClipCaptureView(
                                url: incomingClipURL,
                                onCaptured: { page in finishRenderedClip(page, sourceURL: incomingClipURL) },
                                onFailed: { message in failRenderedClip(message, sourceURL: incomingClipURL) }
                            )
                            .frame(width: 1, height: 1)
                            .opacity(0.01)
                            .allowsHitTesting(false)
                        }
                    }
                    .accessibilityIdentifier("shareImportOverlay")
                }
            }
            .alert(item: $shareImportAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text(env.preferences.t("OK", en: "OK", pl: "OK"))) {
                        if let draft = alert.draft { finishClip(draft) }
                    }
                )
            }
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    // MARK: - Header (Android NotesView parity)

    private var listHeader: some View {
        let searchActive = !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        return VStack(alignment: .leading, spacing: 0) {
            if store.selectionMode {
                HStack(spacing: 0) {
                    Button {
                        store.clearSelection()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.slate)
                            .frame(width: 38, height: 38)
                    }
                    Text(store.selectedMemoIds.isEmpty
                        ? env.preferences.t("Select notes", en: "Select notes", pl: "Wybierz notatki")
                        : env.preferences.t("\(store.selectedMemoIds.count) selected", en: "\(store.selectedMemoIds.count) selected", pl: "Zaznaczone: \(store.selectedMemoIds.count)"))
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                        .padding(.horizontal, 8)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
            }

            HStack(alignment: .center) {
                Button {
                    if store.selectedTag != nil {
                        clearTagFilter()
                    } else {
                        store.showNotebookPicker = true
                    }
                } label: {
                    HStack(spacing: 4) {
                        if store.selectedTag != nil {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        Text(store.selectedTag.map { "#\($0)" } ?? store.activeNotebook?.name ?? env.preferences.t("All notes", en: "All notes", pl: "Wszystkie notatki"))
                            .font(AppTheme.notebookTitleFont)
                            .foregroundStyle(AppTheme.title)
                            .lineLimit(1)
                        if store.selectedTag == nil {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                    }
                    .frame(minHeight: MobileUIMetrics.compactControlHeight)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    store.selectedTag == nil
                        ? env.preferences.t("Switch notebook", en: "Switch notebook", pl: "Przełącz notatnik")
                        : env.preferences.t("Back to notes", en: "Back to notes", pl: "Wróć do notatek")
                )
                Spacer(minLength: 8)
                Button {
                    store.showActions = true
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(AppTheme.slate)
                        .frame(width: MobileUIMetrics.compactControlHeight, height: MobileUIMetrics.compactControlHeight)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("List options", en: "List options", pl: "Opcje listy"))
            }
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(searchActive ? AppTheme.accent : AppTheme.secondary)
                    TextField(env.preferences.t("Search notes", en: "Search notes", pl: "Szukaj notatek"), text: $store.searchText)
                        .font(AppTheme.searchFont)
                        .foregroundStyle(AppTheme.title)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if searchActive {
                        Button {
                            withAnimation(Motion.search) {
                                store.searchText = ""
                            }
                            store.reload(env: env)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(AppTheme.secondary)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 12)
                .frame(height: MobileUIMetrics.compactControlHeight)
                .background(searchActive ? AppTheme.searchActiveFill : AppTheme.searchFill)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(searchActive ? AppTheme.accentBright : Color.clear, lineWidth: 1)
                )
                .animation(Motion.search, value: searchActive)

                filterChip(
                    active: store.filter == .pinned,
                    // Match Android pin filter glyph (star outline / filled when active)
                    systemImage: store.filter == .pinned ? "star.fill" : "star",
                    label: env.preferences.t("Pinned", en: "Pinned", pl: "Przypięte")
                ) {
                    withAnimation(Motion.chip) {
                        store.toggleFilter(.pinned)
                    }
                    store.reload(env: env)
                }
                filterChip(
                    active: store.selectedTag != nil,
                    systemImage: store.selectedTag == nil ? "tag" : "tag.fill",
                    label: store.selectedTag.map { "#\($0)" }
                        ?? env.preferences.t("Filter by tag", en: "Filter by tag", pl: "Filtruj według tagu")
                ) {
                    store.showTagFilterPicker = true
                }
            }
            .ponderSelectionFeedback(store.filter)
            .animation(Motion.chip, value: store.selectedTag)
            .onChange(of: store.searchText) { _, _ in
                store.scheduleSearch(env: env)
            }

            if searchActive || store.filter != .all || store.selectedTag != nil {
                constraintBar
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(AppTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
        .animation(Motion.search, value: searchActive || store.filter != .all || store.selectedTag != nil)
    }

    private var constraintBar: some View {
        let searchActive = !store.searchText.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 8) {
            if searchActive {
                HStack(spacing: 4) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 10, weight: .bold))
                    Text(env.preferences.t("Searching", en: "Searching", pl: "Wyszukiwanie"))
                        .font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(AppTheme.accent)
                .clipShape(Capsule())

                Text(env.preferences.t("\(store.totalCount) results", en: "\(store.totalCount) results", pl: "Wyniki: \(store.totalCount)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(env.preferences.t("Exit", en: "Exit", pl: "Zakończ")) {
                    store.searchText = ""
                    store.reload(env: env)
                }
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.accentText)
            } else {
                Text(env.preferences.t("Filter: \(filterLabelEN) · \(store.totalCount)", en: "Filter: \(filterLabelEN) · \(store.totalCount)", pl: "Filtr: \(filterLabelPL) · \(store.totalCount)"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(AppTheme.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(env.preferences.t("Reset", en: "Reset", pl: "Resetuj")) {
                    if store.selectedTag != nil {
                        clearTagFilter()
                    } else {
                        store.filter = .all
                        store.reload(env: env)
                    }
                }
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(AppTheme.slate)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minHeight: 32)
        .background(searchActive ? AppTheme.searchActiveFill : AppTheme.card)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(searchActive ? AppTheme.accentBorder : AppTheme.border, lineWidth: 1)
        )
        .overlay(alignment: .leading) {
            if searchActive {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(AppTheme.accentBright)
                    .frame(width: 3)
                    .padding(.vertical, 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var filterLabel: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "Pinned"
        case .tagged: return "Tagged"
        case .untagged: return "Untagged"
        case .all: return "All"
        }
    }

    private var filterLabelEN: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "Pinned"
        case .tagged: return "Tagged"
        case .untagged: return "Untagged"
        case .all: return "All"
        }
    }

    private var filterLabelPL: String {
        if let selectedTag = store.selectedTag { return "#\(selectedTag)" }
        switch store.filter {
        case .pinned: return "Przypięte"
        case .tagged: return "Z tagami"
        case .untagged: return "Bez tagów"
        case .all: return "Wszystkie"
        }
    }

    private func clearTagFilter() {
        store.clearTagFilter()
        store.reload(env: env)
    }

    private func filterChip(active: Bool, systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(active ? .white : AppTheme.slate)
                .frame(width: MobileUIMetrics.compactControlHeight, height: MobileUIMetrics.compactControlHeight)
                .background(active ? AppTheme.filterActive : AppTheme.card)
                .clipShape(Circle())
                .overlay(Circle().stroke(active ? AppTheme.filterActive : AppTheme.border, lineWidth: 1))
                .accessibilityLabel(label)
        }
        .buttonStyle(.plain)
    }

    /// Bottom tab chrome:
    /// 1. top separator
    /// 2. Home | Create | Me — all *below* the separator (create must not sit on the line)
    /// 3. home-indicator slab
    /// Create is slightly smaller than the 52pt Android float so it fits cleanly under the line.
    private var bottomNav: some View {
        let canCreate = !store.notebooks.isEmpty
        let bottomInset = MobileUIMetrics.bottomSafeInset
        let createSize = MobileUIMetrics.bottomCreateButtonSize

        return VStack(spacing: 0) {
            // Separator first — tab content is strictly below this line.
            Rectangle()
                .fill(AppTheme.border)
                .frame(height: 1)
                .frame(maxWidth: .infinity)

            HStack(spacing: 0) {
                bottomNavItem(
                    systemImage: "house.fill",
                    label: env.preferences.t("Home", en: "Home", pl: "Start"),
                    active: !showSettings
                ) {
                    showSettings = false
                    withAnimation(Motion.chip) {
                        path = NavigationPath()
                    }
                    if store.selectedTag != nil {
                        clearTagFilter()
                    }
                }

                Button {
                    if createLongPressConsumed {
                        createLongPressConsumed = false
                        return
                    }
                    openCreateNote()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(canCreate ? .white : AppTheme.disabledText)
                        .frame(width: createSize, height: createSize)
                        .background(canCreate ? AppTheme.accentAction : AppTheme.disabledFill)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.white, lineWidth: 3))
                        .shadow(
                            color: AppTheme.fabShadow.opacity(canCreate ? 0.28 : 0),
                            radius: 6,
                            y: 3
                        )
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.45)
                        .onEnded { _ in
                            guard canCreate else { return }
                            createLongPressConsumed = true
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            showCreateChoice = true
                        }
                )
                .disabled(!canCreate)
                .accessibilityLabel(env.preferences.t("New note", en: "New note", pl: "Nowa notatka"))
                .accessibilityHint(env.preferences.t("Long-press to create from a template", en: "Long-press to create from a template", pl: "Przytrzymaj, aby utworzyć z szablonu"))
                .accessibilityIdentifier("bottomCreateButton")
                .frame(maxWidth: .infinity)

                bottomNavItem(
                    systemImage: "person",
                    label: env.preferences.t("Me", en: "Me", pl: "Profil"),
                    active: showSettings
                ) {
                    showSettings = true
                }
            }
            .padding(.horizontal, 28)
            .frame(height: MobileUIMetrics.bottomNavigationHeight)
            .frame(maxWidth: .infinity)

            // Home indicator — same white surface, continuous with the 52pt band.
            AppTheme.card
                .frame(height: bottomInset)
                .frame(maxWidth: .infinity)
        }
        .background(AppTheme.card)
        .accessibilityIdentifier("bottomNav")
    }

    private func bottomNavItem(
        systemImage: String,
        label: String,
        active: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? AppTheme.accentAction : AppTheme.secondary)
                Text(label)
                    .font(AppTheme.bottomNavFont)
                    .foregroundStyle(active ? AppTheme.title : AppTheme.secondary)
            }
            .frame(width: 80, height: 48)
            .overlay(alignment: .top) {
                if active {
                    Capsule()
                        .fill(AppTheme.accentAction)
                        .frame(width: 20, height: 3)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    private func memoDetail(for memoId: String, shareImage: Bool = false) -> some View {
        MemoDetailView(memoId: memoId, initialShareImage: shareImage) { editId, initialFocus in
            editingMemo = EditingMemoRoute(id: editId, initialFocus: initialFocus)
            // Keep the list under the editor so dismissing it does not flash the detail page.
            DispatchQueue.main.async {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    path = NavigationPath()
                }
            }
        }
    }

    private func shareSelectedMemo(_ memo: MemoSummary) async {
        do {
            let share = try await env.session.client.createMemoShare(memoId: memo.id)
            let base = env.session.session?.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
            guard let url = URL(string: "\(base)/share/\(share.token)") else { return }
            let title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayTitle = title?.isEmpty == false
                ? title!
                : env.preferences.t("Untitled note", en: "Untitled note", pl: "Notatka bez tytułu")
            selectionSharePayload = SelectionSharePayload(message: "\(displayTitle)\n\(url.absoluteString)", url: url)
        } catch {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("Share failed", en: "Share failed", pl: "Udostępnianie nie powiodło się"),
                message: error.localizedDescription
            )
        }
    }

    private var selectionBar: some View {
        let bottomInset = MobileUIMetrics.bottomSafeInset
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button {
                    showMoveSheet = true
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "folder")
                        Text(env.preferences.t("Move", en: "Move", pl: "Przenieś")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button(role: .destructive) {
                    Task { await store.softDeleteSelection(env: env) }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "trash")
                        Text(env.preferences.t("Delete", en: "Delete", pl: "Usuń")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
                .disabled(store.selectedMemoIds.isEmpty)
                Button {
                    showSelectionMore = true
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "ellipsis")
                        Text(env.preferences.t("More", en: "More", pl: "Więcej")).font(.caption2.weight(.bold))
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .frame(height: MobileUIMetrics.bottomNavigationHeight, alignment: .top)
            .frame(maxWidth: .infinity)

            AppTheme.card
                .frame(height: bottomInset)
                .frame(maxWidth: .infinity)
        }
        .background(AppTheme.card)
        .overlay(alignment: .top) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
        .accessibilityIdentifier("selectionBar")
    }

    /// Quiet indicator for incremental sync only.
    /// First-login progress + sync-error banners live in `NotesListView` (Android MemoList parity).
    private var syncBanner: some View {
        Group {
            if env.isSyncing && env.bootstrapProgress == nil {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(AppTheme.accent)
                    Text(env.preferences.t("Syncing notes", en: "Syncing notes", pl: "Synchronizowanie notatek"))
                        .font(.caption2)
                        .foregroundStyle(AppTheme.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(AppTheme.card)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.search, value: env.isSyncing)
        .animation(Motion.search, value: env.bootstrapProgress != nil)
    }

    private func openCreateNote(
        seed: CreateMemoSeed? = nil,
        sharedImages: [ShareHandoffStore.SharedImage] = []
    ) {
        guard !store.notebooks.isEmpty else { return }
        if createPresentation.open(.init(seed: seed, sharedImages: sharedImages)) {
            showNewNote = true
        }
    }

    private func openCreateFromTemplate() {
        guard !store.notebooks.isEmpty else { return }
        showTemplatePicker = true
    }

    private func consumeShare() {
        let payloads = env.shareHandoff.consumePending()
        guard !payloads.isEmpty else { return }
        let sharedImages = env.shareHandoff.sharedImages(from: payloads)
        if !sharedImages.isEmpty {
            guard !store.notebooks.isEmpty else {
                sharedImages.forEach(env.shareHandoff.removeImage)
                shareImportAlert = ShareImportAlert(
                    title: env.preferences.t("Unable to save images", en: "Unable to save images", pl: "Nie można zapisać obrazów"),
                    message: env.preferences.t("Create a notebook in Ponder first.", en: "Create a notebook in Ponder first.", pl: "Najpierw utwórz notatnik w Ponder.")
                )
                return
            }
            openCreateNote(
                seed: CreateMemoSeed(
                    title: sharedImages.count == 1
                        ? env.preferences.t("Shared image", en: "Shared image", pl: "Udostępniony obraz")
                        : env.preferences.t("Shared images (\(sharedImages.count))", en: "Shared images (\(sharedImages.count))", pl: "Udostępnione obrazy (\(sharedImages.count))"),
                    contentMarkdown: "",
                    tagsText: ""
                ),
                sharedImages: sharedImages
            )
            return
        }
        guard let sourceURL = WebClipper.sharedWebURL(from: payloads) else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("Unable to clip", en: "Unable to clip", pl: "Nie można przechwycić strony"),
                message: env.preferences.t("The shared content does not contain a recognizable web link.", en: "The shared content does not contain a recognizable web link.", pl: "Udostępniona treść nie zawiera rozpoznawalnego linku do strony.")
            )
            return
        }
        guard !store.notebooks.isEmpty else {
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("Unable to save clip", en: "Unable to save clip", pl: "Nie można zapisać wycinka"),
                message: env.preferences.t("Create a notebook in Ponder first.", en: "Create a notebook in Ponder first.", pl: "Najpierw utwórz notatnik w Ponder.")
            )
            return
        }

        isImportingShare = true
        if WebClipper.isWeChatArticle(sourceURL) {
            incomingClipURL = sourceURL
        } else {
            Task {
                let draft = await WebClipper.build(sourceURL, labels: webClipLabels)
                finishClip(draft)
            }
        }
    }

    private func finishRenderedClip(_ page: RenderedWebPage, sourceURL: URL) {
        finishClip(WebClipper.buildRendered(sourceURL, page: page, labels: webClipLabels))
    }

    private var webClipLabels: WebClipLabels {
        WebClipLabels(
            sourceLabel: env.preferences.t("Source", en: "Source", ja: "出典", pl: "Źródło"),
            capturedAtLabel: env.preferences.t("Captured at", en: "Captured at", ja: "取り込み日時", pl: "Przechwycono"),
            unavailableBody: env.preferences.t(
                "Could not extract the page text. The source link is kept so you can retry later.",
                en: "Could not extract the page text. The source link is kept so you can retry later.",
                ja: "本文を取り込めませんでした。出典リンクは残してあるので、あとからやり直せます。",
                pl: "Nie udało się wyodrębnić tekstu strony. Link źródłowy został zachowany, więc możesz spróbować ponownie później."
            ),
            fallbackTitle: env.preferences.t("Web clip", en: "Web clip", ja: "ウェブクリップ", pl: "Wycinek strony"),
            imageAlt: env.preferences.t("Image", en: "Image", ja: "画像", pl: "Obraz"),
            usesFullwidthColon: false
        )
    }

    private func localizedCaptureFailure(_ message: String) -> String {
        switch message {
        case "The WeChat article took too long to load.":
            return env.preferences.t(
                "The WeChat article took too long to load.",
                en: "The WeChat article took too long to load.",
                ja: "WeChat 記事の読み込みがタイムアウトしました。",
                pl: "Wczytywanie artykułu WeChat trwało zbyt długo."
            )
        case "The page loaded, but no clippable content was found.":
            return env.preferences.t(
                "The page finished loading, but there was no article text to clip.",
                en: "The page finished loading, but there was no article text to clip.",
                ja: "ページの読み込みは終わりましたが、取り込める本文がありません。",
                pl: "Strona została wczytana, ale nie zawiera tekstu artykułu do przechwycenia."
            )
        case "No clippable content was found.":
            return env.preferences.t(
                "No article text was found to clip.",
                en: "No article text was found to clip.",
                ja: "取り込める本文が見つかりません。",
                pl: "Nie znaleziono tekstu artykułu do przechwycenia."
            )
        default:
            return message
        }
    }

    private func failRenderedClip(_ message: String, sourceURL: URL) {
        incomingClipURL = nil
        Task {
            let draft = await WebClipper.build(sourceURL, labels: webClipLabels)
            isImportingShare = false
            shareImportAlert = ShareImportAlert(
                title: env.preferences.t("Article extraction failed", en: "Article extraction failed", ja: "本文を取り込めませんでした", pl: "Nie udało się wyodrębnić artykułu"),
                message: localizedCaptureFailure(message) + " " + env.preferences.t(
                    "The article link was kept. Share it again later to retry.",
                    en: "The article link was kept. Share it again later to retry.",
                    ja: "記事リンクは残してあります。あとから再共有してやり直せます。",
                    pl: "Link do artykułu został zachowany. Udostępnij go ponownie później, aby spróbować jeszcze raz."
                ),
                draft: draft
            )
        }
    }

    private func finishClip(_ draft: WebClipDraft) {
        incomingClipURL = nil
        isImportingShare = false
        openCreateNote(seed: draft.createSeed)
    }

    private func detectConflicts() {
        guard let scope = env.session.dataScope else { return }
        let items = (try? env.outbox.listItems(scope: scope)) ?? []
        conflictItem = items.first { $0.status == .conflict }
    }
}

private struct ShareImportAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    var draft: WebClipDraft? = nil
}

// NotebookPickerSheet / ListActionsSheet live in their own files for Android parity.

struct SelectionMoreSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: WorkspaceStore
    let onShare: (MemoSummary) -> Void
    let onShareImage: (MemoSummary) -> Void

    private var shareableMemo: MemoSummary? {
        guard store.selectedMemoIds.count == 1,
              let memo = store.memos.first(where: { store.selectedMemoIds.contains($0.id) }),
              !memo.isDeleted else { return nil }
        return memo
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 12)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(env.preferences.t("Batch actions", en: "Batch actions", pl: "Działania zbiorcze"))
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(store.selectedMemoIds.isEmpty
                        ? env.preferences.t("Select notes", en: "Select notes", pl: "Wybierz notatki")
                        : env.preferences.t("\(store.selectedMemoIds.count) selected", en: "\(store.selectedMemoIds.count) selected", pl: "Zaznaczone: \(store.selectedMemoIds.count)"))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("Close", en: "Close", pl: "Zamknij"))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            selectionAction(
                icon: "checkmark.square",
                label: store.allVisibleMemosSelected
                    ? env.preferences.t("Deselect current list", en: "Deselect current list", pl: "Odznacz bieżącą listę")
                    : env.preferences.t("Select current list", en: "Select current list", pl: "Zaznacz bieżącą listę"),
                disabled: store.memos.isEmpty
            ) {
                store.toggleVisibleSelection()
                dismiss()
            }

            selectionAction(
                icon: "sparkles",
                label: store.nextSelectionPinValue
                    ? env.preferences.t("Pin", en: "Pin", pl: "Przypnij")
                    : env.preferences.t("Unpin", en: "Unpin", pl: "Odepnij"),
                disabled: store.selectedMemoIds.isEmpty
            ) {
                let target = store.nextSelectionPinValue
                dismiss()
                Task { await store.pinSelection(env: env, isPinned: target) }
            }

            selectionAction(
                icon: "square.and.arrow.up",
                label: env.preferences.t("Share note", en: "Share note", pl: "Udostępnij notatkę"),
                disabled: shareableMemo == nil
            ) {
                guard let memo = shareableMemo else { return }
                dismiss()
                onShare(memo)
            }

            selectionAction(
                icon: "photo",
                label: env.preferences.t("Share as image", en: "Share as image", pl: "Udostępnij jako obraz"),
                disabled: shareableMemo == nil
            ) {
                guard let memo = shareableMemo else { return }
                onShareImage(memo)
                dismiss()
            }

            selectionAction(
                icon: "xmark",
                label: env.preferences.t("Clear selection", en: "Clear selection", pl: "Wyczyść zaznaczenie"),
                disabled: false
            ) {
                store.clearSelection()
                dismiss()
            }

            Spacer(minLength: 0)
        }
        .background(AppTheme.card)
    }

    private func selectionAction(
        icon: String,
        label: String,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 24)
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
            }
            .foregroundStyle(disabled ? AppTheme.muted : AppTheme.title)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

struct MoveNotebookSheet: View {
    @Environment(AppEnvironment.self) private var env
    let notebooks: [Notebook]
    var onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            HStack {
                Text(env.preferences.t("Move to", en: "Move to", pl: "Przenieś do"))
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                Spacer()
                Button(env.preferences.t("Cancel", en: "Cancel", pl: "Anuluj")) { dismiss() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.secondary)
                TextField(env.preferences.t("Search notebooks", en: "Search notebooks", pl: "Szukaj notatników"), text: $query)
                    .font(.system(size: 14))
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(AppTheme.searchFill)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            ScrollView {
                let items = NotebookHierarchy.treeItems(from: notebooks)
                let visible = NotebookHierarchy.searchVisibleIds(notebooks: notebooks, searchText: query)
                VStack(spacing: 0) {
                    ForEach(items.filter { visible.contains($0.id) }) { item in
                        Button {
                            onPick(item.id)
                        } label: {
                            Text(item.name)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(AppTheme.title)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.leading, CGFloat(min(item.depth * 18, 54)))
                                .padding(.horizontal, 12)
                                .frame(minHeight: 48)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .background(AppTheme.card)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }
}
