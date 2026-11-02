import Foundation

public enum PanelLink: Equatable, Sendable {
    case open
    case session(String)

    public static func parse(_ url: URL) -> PanelLink? {
        guard url.scheme == "ccc" else {
            return nil
        }

        let parts = url.pathComponents.filter { $0 != "/" }

        switch url.host {
        case "open":
            return .open
        case "session":
            return parts.first.map(PanelLink.session)
        default:
            return nil
        }
    }
}
