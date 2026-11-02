import Testing
@testable import ControlCenterCore

struct PanelToggleTests {
    @Test func hiddenShows() {
        #expect(toggleAction(isVisible: false) == .show)
    }

    @Test func visibleHidesWhereverTheFocusIs() {
        #expect(toggleAction(isVisible: true) == .hide)
    }
}
