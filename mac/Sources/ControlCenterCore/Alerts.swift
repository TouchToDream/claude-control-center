import Foundation

public struct AlertItem: Codable, Equatable, Sendable {
    public let id: String
    public let sessionId: String?
    public let event: String
    public let title: String
    public let body: String
    public let createdAt: Double

    public init(id: String, sessionId: String?, event: String, title: String, body: String, createdAt: Double) {
        self.id = id
        self.sessionId = sessionId
        self.event = event
        self.title = title
        self.body = body
        self.createdAt = createdAt
    }
}

public func sessionToOpen(hiddenAt: Double?, unread: [AlertItem]) -> String? {
    guard let hiddenAt else {
        return nil
    }

    return unread
        .filter { $0.sessionId != nil && $0.createdAt > hiddenAt }
        .max { $0.createdAt < $1.createdAt }?
        .sessionId
}

public func badgeText(count: Int) -> String? {
    if count <= 0 {
        return nil
    }

    return count > 99 ? "99+" : String(count)
}

public func menuAlerts(_ unread: [AlertItem], limit: Int = 10) -> (shown: [AlertItem], more: Int) {
    (Array(unread.prefix(limit)), max(0, unread.count - limit))
}

public enum ServiceEvent: Equatable, Sendable {
    case state(unread: [AlertItem])
    case alert(AlertItem)
    case other

    private struct Envelope: Decodable {
        struct State: Decodable {
            let alerts: [AlertItem]?
        }

        let type: String
        let state: State?
        let alert: AlertItem?
    }

    public static func decode(_ data: Data) -> ServiceEvent {
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else {
            return .other
        }

        switch envelope.type {
        case "state":
            return .state(unread: envelope.state?.alerts ?? [])
        case "alert":
            return envelope.alert.map(ServiceEvent.alert) ?? .other
        default:
            return .other
        }
    }
}
