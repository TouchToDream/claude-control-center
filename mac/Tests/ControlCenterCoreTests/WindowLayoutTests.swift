import Foundation
import Testing
@testable import ControlCenterCore

struct WindowLayoutTests {
    @Test func halfScreenFollowsTheScreen() {
        let layout = WindowLayout.from(frame: CGRect(x: 960, y: 0, width: 960, height: 1080), in: CGRect(x: 0, y: 0, width: 1920, height: 1080))

        #expect(layout == WindowLayout(x: 0.5, y: 0, width: 0.5, height: 1))
        #expect(layout.frame(in: CGRect(x: 0, y: 0, width: 2560, height: 1440)) == CGRect(x: 1280, y: 0, width: 1280, height: 1440))
    }

    @Test func negativeOriginScreen() {
        let frame = WindowLayout.initial.frame(in: CGRect(x: -1920, y: 200, width: 1920, height: 1080))

        #expect(frame == CGRect(x: -960, y: 200, width: 960, height: 1080))
    }

    @Test func layoutFromAScreenWithNegativeOrigin() {
        let screen = CGRect(x: -1920, y: 200, width: 1920, height: 1080)
        let layout = WindowLayout.from(frame: CGRect(x: -1920, y: 200, width: 960, height: 540), in: screen)

        #expect(layout == WindowLayout(x: 0, y: 0, width: 0.5, height: 0.5))
    }

    @Test func tooLargeIsClamped() {
        let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        let frame = WindowLayout(x: 0.9, y: 0, width: 0.5, height: 1).frame(in: screen)

        #expect(screen.contains(frame))
        #expect(frame.width == 960)
        #expect(frame.maxX == 1920)
    }

    @Test func minimumSize() {
        let frame = WindowLayout(x: 0, y: 0, width: 0.01, height: 0.01).frame(in: CGRect(x: 0, y: 0, width: 1920, height: 1080))

        #expect(frame.width == 420)
        #expect(frame.height == 360)
    }

    @Test func codableRoundTrip() throws {
        let layout = WindowLayout(x: 0.25, y: 0.1, width: 0.5, height: 0.8)
        let decoded = try JSONDecoder().decode(WindowLayout.self, from: JSONEncoder().encode(layout))

        #expect(decoded == layout)
    }
}
