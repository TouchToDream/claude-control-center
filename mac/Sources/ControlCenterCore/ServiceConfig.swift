import Foundation

public struct ServiceConfig: Equatable, Sendable {
    public let port: Int
    public let key: String

    public init(port: Int, key: String) {
        self.port = port
        self.key = key
    }

    public var baseURL: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    public static func file(environment: [String: String]) -> URL {
        let folder = environment["CCC_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-control-center")

        return folder.appendingPathComponent("config.json")
    }

    public static var defaultFile: URL {
        file(environment: ProcessInfo.processInfo.environment)
    }

    private struct Stored: Decodable {
        let port: Int
        let key: String
    }

    public static func load(from file: URL = defaultFile) throws -> ServiceConfig {
        let stored = try JSONDecoder().decode(Stored.self, from: Data(contentsOf: file))

        return ServiceConfig(port: stored.port, key: stored.key)
    }
}

public func retryDelay(attempt: Int) -> Double {
    min(0.5 * pow(2, Double(max(0, attempt))), 5)
}
