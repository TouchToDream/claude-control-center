import AppKit
import ControlCenterCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let panel = PanelWindow()
    private let web = WebPanel()
    private let alerts = AlertCenter()
    private let link = ServiceLink()
    private var hotKeys: HotKeyCenter!
    private var settings: SettingsWindowController!
    private var statusMenu: StatusMenu!
    private var hiddenAt: Double? = Date().timeIntervalSince1970 * 1000
    private var unread: [AlertItem] = []
    private var unreadIds: [String] = []
    private var isPlacing = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        hotKeys = HotKeyCenter { [weak self] in
            self?.toggle()
        }
        hotKeys.register(Preferences.hotKey)

        panel.contentView = web.view
        panel.delegate = self
        panel.onHide = { [weak self] in
            self?.hide()
        }
        web.load()

        alerts.requestAuthorization()
        alerts.onOpen = { [weak self] sessionId in
            self?.show(sessionId: sessionId, onlyIfNoDraft: false)
        }

        if !Preferences.didSetUpLoginItem {
            LoginItem.set(true)
            Preferences.didSetUpLoginItem = true
        }

        let model = SettingsModel(hotKeys: hotKeys, alerts: alerts)

        model.onHotKeyChange = { [weak self] combo in
            self?.statusMenu.update { $0.hotKey = combo }
        }
        settings = SettingsWindowController(model: model)

        statusMenu = StatusMenu(
            state: StatusMenuState(hotKey: Preferences.hotKey, launchAtLogin: LoginItem.isEnabled),
            actions: StatusMenuActions(
                openPanel: { [weak self] in self?.show(sessionId: nil, onlyIfNoDraft: true) },
                openAlert: { [weak self] alert in self?.show(sessionId: alert.sessionId, onlyIfNoDraft: false) },
                startService: { [weak self] in self?.startService() },
                openSettings: { [weak self] in self?.settings.show() },
                openNotificationSettings: { AlertCenter.openSystemSettings() },
                refresh: { [weak self] in self?.refreshNotificationState() },
                toggleLoginItem: { [weak self] in
                    LoginItem.set(!LoginItem.isEnabled)
                    self?.statusMenu.update { $0.launchAtLogin = LoginItem.isEnabled }
                },
                quit: { NSApp.terminate(nil) }
            )
        )

        link.onReachable = { [weak self] isReachable in
            self?.statusMenu.update { $0.isReachable = isReachable }
        }
        link.onUnread = { [weak self] unread in
            self?.receive(unread)
        }
        link.onAlert = { [weak self] alert in
            self?.alerts.post(alert)
        }
        link.start()
        refreshNotificationState()

        if Preferences.hotKey == nil {
            settings.show()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            switch PanelLink.parse(url) {
            case .open:
                show(sessionId: nil, onlyIfNoDraft: true)
            case .session(let sessionId):
                show(sessionId: sessionId, onlyIfNoDraft: false)
            case nil:
                break
            }
        }
    }

    private func receive(_ unread: [AlertItem]) {
        let ids = unread.map(\.id)

        guard ids != unreadIds else {
            return
        }

        self.unread = unread
        unreadIds = ids
        statusMenu.update { $0.unread = unread }
        alerts.keepOnly(unread)
    }

    private func refreshNotificationState() {
        alerts.isBlocked { [weak self] isBlocked in
            self?.statusMenu.update { $0.notificationsBlocked = isBlocked }
        }
    }

    private func startService() {
        let label = "com.claude-control-center"
        let plist = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
        let process = Process()

        if FileManager.default.fileExists(atPath: plist.path) {
            process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            process.arguments = ["kickstart", "gui/\(getuid())/\(label)"]
        } else if let repo = Bundle.main.object(forInfoDictionaryKey: "CCCRepoPath") as? String {
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-lc", "cd \"$0\" && npm run ccc -- start", repo]
        } else {
            return
        }

        try? process.run()
    }

    func toggle() {
        let screen = mouseScreen()

        switch toggleAction(isVisible: panel.isVisible, isKey: panel.isKeyWindow, isOnMouseScreen: panel.screen == screen) {
        case .show:
            show(sessionId: sessionToOpen(hiddenAt: hiddenAt, unread: unread), onlyIfNoDraft: true)
        case .hide:
            hide()
        case .focus(let moveToMouseScreen):
            if moveToMouseScreen {
                place(on: screen)
            }

            focus()
        }
    }

    func show(sessionId: String?, onlyIfNoDraft: Bool) {
        if !panel.isVisible {
            place(on: mouseScreen())
            panel.orderFrontRegardless()
        }

        focus()

        if let sessionId {
            web.show(sessionId: sessionId, onlyIfNoDraft: onlyIfNoDraft)
        }

        web.setShown(true)
    }

    func hide() {
        hiddenAt = Date().timeIntervalSince1970 * 1000
        web.setShown(false)
        panel.orderOut(nil)

        if NSApp.isActive {
            NSApp.hide(nil)
        }
    }

    func windowDidMove(_ notification: Notification) {
        saveLayout()
    }

    func windowDidResize(_ notification: Notification) {
        saveLayout()
    }

    private func focus() {
        panel.makeKey()
        panel.makeFirstResponder(web.view)
    }

    private func place(on screen: NSScreen) {
        isPlacing = true
        panel.setFrame(Preferences.layout.frame(in: screen.visibleFrame), display: true)
        isPlacing = false
    }

    private func saveLayout() {
        guard !isPlacing, panel.isVisible, let screen = panel.screen else {
            return
        }

        Preferences.layout = WindowLayout.from(frame: panel.frame, in: screen.visibleFrame)
    }

    private func mouseScreen() -> NSScreen {
        let point = NSEvent.mouseLocation

        return NSScreen.screens.first { NSMouseInRect(point, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
    }
}
