import AppKit
import ControlCenterCore

struct StatusMenuState {
    var hotKey: HotKeyCombo?
    var unread: [AlertItem] = []
    var isReachable = true
    var launchAtLogin = false
    var notificationsBlocked = false
}

struct StatusMenuActions {
    var openPanel: () -> Void
    var openAlert: (AlertItem) -> Void
    var startService: () -> Void
    var openSettings: () -> Void
    var openNotificationSettings: () -> Void
    var refresh: () -> Void
    var toggleLoginItem: () -> Void
    var quit: () -> Void
}

final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let actions: StatusMenuActions
    private var state: StatusMenuState
    private var handlers: [ObjectIdentifier: () -> Void] = [:]

    init(state: StatusMenuState, actions: StatusMenuActions) {
        self.state = state
        self.actions = actions

        super.init()

        let menu = NSMenu()

        menu.delegate = self
        item.menu = menu

        if let button = item.button {
            let image = NSImage(systemSymbolName: "rectangle.stack", accessibilityDescription: "Claude Control Center")

            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
        }

        render()
    }

    func update(_ change: (inout StatusMenuState) -> Void) {
        change(&state)
        render()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        actions.refresh()
        menu.removeAllItems()
        handlers = [:]

        let hotKey = state.hotKey.map { " (\($0.display))" } ?? ""

        add(to: menu, "Відкрити панель\(hotKey)", actions.openPanel)

        let alerts = menuAlerts(state.unread)

        if !alerts.shown.isEmpty {
            menu.addItem(.separator())

            for alert in alerts.shown {
                add(to: menu, "\(alert.title) — \(alert.body)") { [actions] in
                    actions.openAlert(alert)
                }
            }

            if alerts.more > 0 {
                let more = NSMenuItem(title: "Ще \(alerts.more)", action: nil, keyEquivalent: "")

                more.isEnabled = false
                menu.addItem(more)
            }
        }

        if !state.isReachable {
            menu.addItem(.separator())

            let note = NSMenuItem(title: "Сервіс не відповідає", action: nil, keyEquivalent: "")

            note.isEnabled = false
            menu.addItem(note)
            add(to: menu, "Запустити сервіс", actions.startService)
        }

        if state.notificationsBlocked {
            menu.addItem(.separator())

            let note = NSMenuItem(title: "Сповіщення вимкнені в macOS", action: nil, keyEquivalent: "")

            note.isEnabled = false
            menu.addItem(note)
            add(to: menu, "Увімкнути сповіщення…", actions.openNotificationSettings)
        }

        menu.addItem(.separator())
        add(to: menu, "Налаштування…", actions.openSettings)

        let login = add(to: menu, "Запускати під час входу", actions.toggleLoginItem)

        login.state = state.launchAtLogin ? .on : .off
        menu.addItem(.separator())
        add(to: menu, "Вийти", actions.quit)
    }

    @discardableResult
    private func add(to menu: NSMenu, _ title: String, _ handler: @escaping () -> Void) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: #selector(run(_:)), keyEquivalent: "")

        menuItem.target = self
        handlers[ObjectIdentifier(menuItem)] = handler
        menu.addItem(menuItem)

        return menuItem
    }

    @objc private func run(_ sender: NSMenuItem) {
        handlers[ObjectIdentifier(sender)]?()
    }

    private func render() {
        guard let button = item.button else {
            return
        }

        button.title = badgeText(count: state.unread.count).map { " \($0)" } ?? ""
        button.appearsDisabled = !state.isReachable
    }
}
