public struct HotKeyCombo: Codable, Equatable, Sendable {
    public static let command: UInt32 = 256
    public static let shift: UInt32 = 512
    public static let option: UInt32 = 2048
    public static let control: UInt32 = 4096

    public let keyCode: UInt32
    public let modifiers: UInt32

    public init(keyCode: UInt32, modifiers: UInt32) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    private static let symbolKeys: Set<UInt32> = [10, 50]
    private static let functionKeys: Set<UInt32> = [
        122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
    ]

    private var hasStrongModifier: Bool {
        modifiers & (Self.command | Self.control | Self.option) != 0
    }

    public var isAcceptable: Bool {
        hasStrongModifier || Self.symbolKeys.contains(keyCode) || Self.functionKeys.contains(keyCode)
    }

    public var swallowsTyping: Bool {
        !hasStrongModifier && Self.symbolKeys.contains(keyCode)
    }

    public var display: String {
        let marks: [(UInt32, String)] = [(Self.control, "⌃"), (Self.option, "⌥"), (Self.shift, "⇧"), (Self.command, "⌘")]

        return marks.filter { modifiers & $0.0 != 0 }.map(\.1).joined() + Self.keyName(keyCode)
    }

    private static let names: [UInt32: String] = [
        0: "A", 1: "S", 10: "§", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 12: "Q",
        13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5",
        24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0", 30: "]", 31: "O", 32: "U", 33: "[", 34: "I",
        35: "P", 36: "Return", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/",
        45: "N", 46: "M", 47: ".", 48: "Tab", 49: "Space", 50: "`", 51: "Delete", 53: "Esc",
        96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9", 103: "F11", 109: "F10", 111: "F12",
        118: "F4", 120: "F2", 122: "F1", 105: "F13", 107: "F14", 113: "F15", 106: "F16", 64: "F17", 79: "F18",
        80: "F19", 90: "F20", 123: "←", 124: "→", 125: "↓", 126: "↑",
    ]

    public static func keyName(_ keyCode: UInt32) -> String {
        names[keyCode] ?? "#\(keyCode)"
    }
}
