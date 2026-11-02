import ControlCenterCore
import Foundation
import ServiceManagement

enum Preferences {
    private static let defaults = UserDefaults.standard

    static var hotKey: HotKeyCombo? {
        get { decode("hotKey") }
        set { encode(newValue, forKey: "hotKey") }
    }

    static var layout: WindowLayout {
        get { decode("layout") ?? .initial }
        set { encode(newValue, forKey: "layout") }
    }

    static var didSetUpLoginItem: Bool {
        get { defaults.bool(forKey: "didSetUpLoginItem") }
        set { defaults.set(newValue, forKey: "didSetUpLoginItem") }
    }

    private static func decode<Value: Decodable>(_ key: String) -> Value? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Value.self, from: $0) }
    }

    private static func encode<Value: Encodable>(_ value: Value?, forKey key: String) {
        if let value, let data = try? JSONEncoder().encode(value) {
            defaults.set(data, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
}

enum LoginItem {
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    @discardableResult
    static func set(_ isOn: Bool) -> Bool {
        do {
            if isOn {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }

            return true
        } catch {
            NSLog("Claude Control Center: login item change failed: \(error.localizedDescription)")

            return false
        }
    }
}
