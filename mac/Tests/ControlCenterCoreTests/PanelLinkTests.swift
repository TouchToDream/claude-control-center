import Foundation
import Testing
@testable import ControlCenterCore

struct PanelLinkTests {
    @Test func openLink() {
        #expect(PanelLink.parse(URL(string: "ccc://open")!) == .open)
    }

    @Test func sessionLink() {
        #expect(PanelLink.parse(URL(string: "ccc://session/96659627-575d-4fad-8f6f-6031a3d639d3")!) == .session("96659627-575d-4fad-8f6f-6031a3d639d3"))
    }

    @Test func otherLinksAreIgnored() {
        #expect(PanelLink.parse(URL(string: "ccc://session/")!) == nil)
        #expect(PanelLink.parse(URL(string: "ccc://delete/x")!) == nil)
        #expect(PanelLink.parse(URL(string: "https://example.com/session/x")!) == nil)
    }
}
