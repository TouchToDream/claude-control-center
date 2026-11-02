import AppKit
import ControlCenterCore
import UserNotifications

final class AlertCenter: NSObject, UNUserNotificationCenterDelegate {
    static let testPrefix = "test-"

    var onOpen: ((String?) -> Void)?

    private let center = UNUserNotificationCenter.current()

    override init() {
        super.init()
        center.delegate = self
    }

    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
            if let error {
                NSLog("Claude Control Center: notification permission failed: \(error.localizedDescription)")
            }
        }
    }

    func post(_ alert: AlertItem) {
        let content = UNMutableNotificationContent()

        content.title = alert.title
        content.body = alert.body
        content.sound = .default
        content.userInfo = ["sessionId": alert.sessionId ?? ""]
        center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: nil))
    }

    func postTest() {
        post(AlertItem(
            id: Self.testPrefix + UUID().uuidString,
            sessionId: nil,
            event: "test",
            title: "Claude Control Center",
            body: "Тестове сповіщення: усе працює",
            createdAt: Date().timeIntervalSince1970 * 1000
        ))
    }

    func isBlocked(_ done: @escaping (Bool) -> Void) {
        center.getNotificationSettings { settings in
            let isBlocked = settings.authorizationStatus == .denied

            DispatchQueue.main.async {
                done(isBlocked)
            }
        }
    }

    static func openSystemSettings() {
        let address = "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(Bundle.main.bundleIdentifier ?? "")"

        if let url = URL(string: address) {
            NSWorkspace.shared.open(url)
        }
    }

    func remove(ids: [String]) {
        if !ids.isEmpty {
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    func keepOnly(_ unread: [AlertItem]) {
        let keep = Set(unread.map(\.id))

        deliveredIds { [weak self] ids in
            self?.remove(ids: ids.filter { !keep.contains($0) && !$0.hasPrefix(Self.testPrefix) })
        }
    }

    func deliveredIds(_ done: @escaping ([String]) -> Void) {
        center.getDeliveredNotifications { notifications in
            let ids = notifications.map(\.request.identifier)

            DispatchQueue.main.async {
                done(ids)
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let sessionId = response.notification.request.content.userInfo["sessionId"] as? String

        DispatchQueue.main.async {
            self.onOpen?(sessionId?.isEmpty == false ? sessionId : nil)
        }

        completionHandler()
    }
}
