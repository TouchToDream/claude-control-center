import Testing
@testable import ControlCenterCore

struct PanelToggleTests {
    @Test func hiddenShows() {
        #expect(toggleAction(isVisible: false, isKey: false, isOnMouseScreen: false) == .show)
    }

    @Test func visibleAndFocusedHides() {
        #expect(toggleAction(isVisible: true, isKey: true, isOnMouseScreen: true) == .hide)
    }

    @Test func visibleWithoutFocusOnTheSameScreenTakesFocus() {
        #expect(toggleAction(isVisible: true, isKey: false, isOnMouseScreen: true) == .focus(moveToMouseScreen: false))
    }

    @Test func visibleWithoutFocusOnAnotherScreenMovesAndTakesFocus() {
        #expect(toggleAction(isVisible: true, isKey: false, isOnMouseScreen: false) == .focus(moveToMouseScreen: true))
    }
}
