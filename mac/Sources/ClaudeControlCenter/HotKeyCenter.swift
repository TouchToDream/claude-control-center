import Carbon
import ControlCenterCore
import Foundation

final class HotKeyCenter {
    private static let modifierMask: UInt32 = HotKeyCombo.command | HotKeyCombo.shift | HotKeyCombo.option | HotKeyCombo.control

    private let onPress: () -> Void
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private(set) var current: HotKeyCombo?

    init(onPress: @escaping () -> Void) {
        self.onPress = onPress

        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()

        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else {
                return noErr
            }

            let center = Unmanaged<HotKeyCenter>.fromOpaque(context).takeUnretainedValue()

            DispatchQueue.main.async {
                center.onPress()
            }

            return noErr
        }, 1, &spec, context, &handler)
    }

    @discardableResult
    func register(_ combo: HotKeyCombo?) -> Bool {
        let previous = current

        unregisterReference()

        guard let combo else {
            current = nil

            return true
        }

        if registerReference(combo) {
            current = combo

            return true
        }

        if let previous {
            registerReference(previous)
        }

        return false
    }

    func suspend() {
        unregisterReference()
    }

    func resume() {
        if let current, reference == nil {
            registerReference(current)
        }
    }

    func isTakenBySystem(_ combo: HotKeyCombo) -> Bool {
        var list: Unmanaged<CFArray>?

        guard CopySymbolicHotKeys(&list) == noErr, let entries = list?.takeRetainedValue() as? [[String: Any]] else {
            return false
        }

        return entries.contains { entry in
            let isEnabled = (entry[kHISymbolicHotKeyEnabled as String] as? Bool) ?? false
            let keyCode = (entry[kHISymbolicHotKeyCode as String] as? Int).map { UInt32($0) }
            let modifiers = (entry[kHISymbolicHotKeyModifiers as String] as? Int).map { UInt32($0) & Self.modifierMask }

            return isEnabled && keyCode == combo.keyCode && modifiers == combo.modifiers & Self.modifierMask
        }
    }

    @discardableResult
    private func registerReference(_ combo: HotKeyCombo) -> Bool {
        var created: EventHotKeyRef?
        let identifier = EventHotKeyID(signature: OSType(0x4343_4343), id: 1)
        let status = RegisterEventHotKey(combo.keyCode, combo.modifiers, identifier, GetApplicationEventTarget(), 0, &created)

        guard status == noErr, let created else {
            return false
        }

        reference = created

        return true
    }

    private func unregisterReference() {
        if let reference {
            UnregisterEventHotKey(reference)
        }

        reference = nil
    }
}
