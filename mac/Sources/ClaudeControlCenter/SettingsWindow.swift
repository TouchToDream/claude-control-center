import AppKit
import ControlCenterCore
import SwiftUI

final class SettingsModel: ObservableObject {
    @Published var hotKey: HotKeyCombo?
    @Published var isRecording = false
    @Published var error: String?
    @Published var launchAtLogin: Bool
    @Published var notificationsBlocked = false

    var onHotKeyChange: ((HotKeyCombo) -> Void)?
    weak var window: NSWindow?

    private let hotKeys: HotKeyCenter
    private let alerts: AlertCenter
    private var monitor: Any?

    init(hotKeys: HotKeyCenter, alerts: AlertCenter) {
        self.hotKeys = hotKeys
        self.alerts = alerts
        hotKey = Preferences.hotKey
        launchAtLogin = LoginItem.isEnabled
    }

    func startRecording() {
        error = nil
        isRecording = true
        hotKeys.suspend()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.window else {
                return event
            }

            self.capture(event)

            return nil
        }
    }

    func stopRecording() {
        guard isRecording else {
            return
        }

        if let monitor {
            NSEvent.removeMonitor(monitor)
        }

        monitor = nil
        isRecording = false
        hotKeys.resume()
    }

    func setLaunchAtLogin(_ isOn: Bool) {
        LoginItem.set(isOn)
        launchAtLogin = LoginItem.isEnabled
    }

    func refresh() {
        launchAtLogin = LoginItem.isEnabled
        alerts.isBlocked { [weak self] isBlocked in
            self?.notificationsBlocked = isBlocked
        }
    }

    func openNotificationSettings() {
        AlertCenter.openSystemSettings()
    }

    func sendTest() {
        alerts.postTest()
    }

    private func capture(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])

        if event.keyCode == 53, flags.isEmpty {
            stopRecording()

            return
        }

        let combo = HotKeyCombo(keyCode: UInt32(event.keyCode), modifiers: carbonModifiers(flags))

        guard combo.isAcceptable else {
            error = "Без ⌘, ⌃ або ⌥ можна задати лише ` , § або F1–F20"

            return
        }

        guard !hotKeys.isTakenBySystem(combo) else {
            error = "Це поєднання вже зайняте"

            return
        }

        stopRecording()

        if hotKeys.register(combo) {
            hotKey = combo
            Preferences.hotKey = combo
            onHotKeyChange?(combo)
        } else {
            error = "Це поєднання вже зайняте"
        }
    }

    private func carbonModifiers(_ flags: NSEvent.ModifierFlags) -> UInt32 {
        let pairs: [(NSEvent.ModifierFlags, UInt32)] = [
            (.command, HotKeyCombo.command),
            (.shift, HotKeyCombo.shift),
            (.option, HotKeyCombo.option),
            (.control, HotKeyCombo.control),
        ]

        return pairs.filter { flags.contains($0.0) }.reduce(0) { $0 | $1.1 }
    }
}

struct SettingsView: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        Form {
            Section {
                LabeledContent("Гаряча клавіша") {
                    HStack {
                        Text(model.isRecording ? "Натисни поєднання…" : (model.hotKey?.display ?? "не задано"))
                            .monospaced()
                        Button(model.isRecording ? "Скасувати" : "Змінити") {
                            if model.isRecording {
                                model.stopRecording()
                            } else {
                                model.startRecording()
                            }
                        }
                    }
                }

                if let error = model.error {
                    Text(error).foregroundStyle(.red)
                }

                if model.hotKey?.swallowsTyping == true, !model.isRecording {
                    Text("Поки задана ця клавіша, її символ не друкується в жодній програмі.")
                        .foregroundStyle(.orange)
                }

                Text("Клавіша показує й ховає панель над будь-якою програмою.")
                    .foregroundStyle(.secondary)
            }

            Section {
                Toggle("Запускати під час входу", isOn: Binding(
                    get: { model.launchAtLogin },
                    set: { model.setLaunchAtLogin($0) }
                ))
            }

            Section {
                if model.notificationsBlocked {
                    Text("Сповіщення для програми вимкнені в macOS.").foregroundStyle(.red)
                    Button("Відкрити налаштування сповіщень macOS") {
                        model.openNotificationSettings()
                    }
                }

                Button("Надіслати тестове сповіщення") {
                    model.sendTest()
                }

                Text("Про які події сповіщати, налаштовується в панелі: кнопка налаштувань сповіщень у шапці.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: SettingsWindowController.size.width, height: SettingsWindowController.size.height)
    }
}

final class SettingsWindowController: NSObject, NSWindowDelegate {
    static let size = CGSize(width: 480, height: 380)

    let model: SettingsModel

    private lazy var window: NSWindow = {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.size),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )

        window.contentView = NSHostingView(rootView: SettingsView(model: model))
        window.title = "Налаштування Claude Control Center"
        window.isReleasedWhenClosed = false
        window.delegate = self
        model.window = window

        return window
    }()

    init(model: SettingsModel) {
        self.model = model
    }

    func windowWillClose(_ notification: Notification) {
        model.stopRecording()
    }

    func windowDidResignKey(_ notification: Notification) {
        model.stopRecording()
    }

    func show() {
        model.refresh()
        NSApp.activate()
        window.center()
        window.makeKeyAndOrderFront(nil)
    }
}
