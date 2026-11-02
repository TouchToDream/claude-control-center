import Foundation
import Testing
@testable import ControlCenterCore

struct ServiceConfigTests {
    @Test func readsPortAndKey() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("ccc-config-\(UUID().uuidString).json")

        try Data(#"{"port":47821,"key":"k","idleMinutes":10}"#.utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        let config = try ServiceConfig.load(from: file)

        #expect(config == ServiceConfig(port: 47821, key: "k"))
        #expect(config.baseURL.absoluteString == "http://127.0.0.1:47821")
    }

    @Test func missingFileThrows() {
        #expect(throws: (any Error).self) {
            try ServiceConfig.load(from: URL(fileURLWithPath: "/nonexistent/config.json"))
        }
    }

    @Test func retryDelays() {
        #expect((0..<6).map(retryDelay(attempt:)) == [0.5, 1, 2, 4, 5, 5])
    }
}

struct ServiceConfigHomeTests {
    @Test func homeFolderComesFromTheEnvironment() {
        #expect(ServiceConfig.file(environment: ["CCC_HOME": "/tmp/ccc-test"]).path == "/tmp/ccc-test/config.json")
        #expect(ServiceConfig.file(environment: [:]).path.hasSuffix("/.claude-control-center/config.json"))
    }
}
