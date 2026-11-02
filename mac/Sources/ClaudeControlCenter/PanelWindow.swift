import AppKit

final class PanelWindow: NSPanel {
    private static let editKeys: [UInt16: (plain: Selector, shifted: Selector?)] = [
        7: (#selector(NSText.cut(_:)), nil),
        8: (#selector(NSText.copy(_:)), nil),
        9: (#selector(NSText.paste(_:)), nil),
        0: (#selector(NSResponder.selectAll(_:)), nil),
        6: (Selector(("undo:")), Selector(("redo:"))),
    ]
    private static let closeKey: UInt16 = 13
    private static let reloadKey: UInt16 = 15

    var onHide: (() -> Void)?
    var onReload: (() -> Void)?

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        title = "Claude Control Center"
        titleVisibility = .hidden
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        becomesKeyOnlyIfNeeded = false
        minSize = NSSize(width: 420, height: 360)
    }

    override var canBecomeKey: Bool {
        true
    }

    override var canBecomeMain: Bool {
        true
    }

    override func performClose(_ sender: Any?) {
        onHide?()
    }

    override func cancelOperation(_ sender: Any?) {}

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])

        guard flags == .command || flags == [.command, .shift] else {
            return super.performKeyEquivalent(with: event)
        }

        if event.keyCode == Self.closeKey, flags == .command {
            onHide?()

            return true
        }

        if event.keyCode == Self.reloadKey, flags == .command {
            onReload?()

            return true
        }

        guard let keys = Self.editKeys[event.keyCode] else {
            return super.performKeyEquivalent(with: event)
        }

        let action = flags == .command ? keys.plain : keys.shifted

        if let action, NSApp.sendAction(action, to: nil, from: self) {
            return true
        }

        return super.performKeyEquivalent(with: event)
    }
}
