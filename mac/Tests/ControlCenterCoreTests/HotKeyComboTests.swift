import Foundation
import Testing
@testable import ControlCenterCore

struct HotKeyComboTests {
    @Test func controlOptionSpace() {
        let combo = HotKeyCombo(keyCode: 49, modifiers: HotKeyCombo.control | HotKeyCombo.option)

        #expect(combo.display == "⌃⌥Space")
        #expect(combo.isAcceptable)
    }

    @Test func allModifiersInSystemOrder() {
        let combo = HotKeyCombo(keyCode: 40, modifiers: HotKeyCombo.command | HotKeyCombo.shift | HotKeyCombo.option | HotKeyCombo.control)

        #expect(combo.display == "⌃⌥⇧⌘K")
    }

    @Test func shiftOnlyIsRefused() {
        #expect(!HotKeyCombo(keyCode: 0, modifiers: HotKeyCombo.shift).isAcceptable)
    }

    @Test func plainLetterIsRefused() {
        #expect(!HotKeyCombo(keyCode: 0, modifiers: 0).isAcceptable)
    }

    @Test func commandKIsAccepted() {
        let combo = HotKeyCombo(keyCode: 40, modifiers: HotKeyCombo.command)

        #expect(combo.isAcceptable)
        #expect(combo.display == "⌘K")
    }

    @Test func keyNames() {
        #expect(HotKeyCombo.keyName(0) == "A")
        #expect(HotKeyCombo.keyName(18) == "1")
        #expect(HotKeyCombo.keyName(36) == "Return")
        #expect(HotKeyCombo.keyName(122) == "F1")
        #expect(HotKeyCombo.keyName(126) == "↑")
        #expect(HotKeyCombo.keyName(500) == "#500")
    }

    @Test func codableRoundTrip() throws {
        let combo = HotKeyCombo(keyCode: 49, modifiers: HotKeyCombo.option)
        let decoded = try JSONDecoder().decode(HotKeyCombo.self, from: JSONEncoder().encode(combo))

        #expect(decoded == combo)
    }
}

struct SingleKeyTests {
    @Test func backquoteAloneIsAcceptedAndWarned() {
        let combo = HotKeyCombo(keyCode: 50, modifiers: 0)

        #expect(combo.isAcceptable)
        #expect(combo.swallowsTyping)
        #expect(combo.display == "`")
    }

    @Test func tildeWithShiftIsAccepted() {
        let combo = HotKeyCombo(keyCode: 50, modifiers: HotKeyCombo.shift)

        #expect(combo.isAcceptable)
        #expect(combo.swallowsTyping)
        #expect(combo.display == "⇧`")
    }

    @Test func sectionKeyAloneIsAccepted() {
        #expect(HotKeyCombo(keyCode: 10, modifiers: 0).isAcceptable)
        #expect(HotKeyCombo.keyName(10) == "§")
    }

    @Test func functionKeyAloneIsAcceptedWithoutWarning() {
        let combo = HotKeyCombo(keyCode: 96, modifiers: 0)

        #expect(combo.isAcceptable)
        #expect(!combo.swallowsTyping)
        #expect(HotKeyCombo.keyName(105) == "F13")
    }

    @Test func typingKeysAloneAreStillRefused() {
        for keyCode: UInt32 in [0, 18, 49, 36, 48, 53, 123] {
            #expect(!HotKeyCombo(keyCode: keyCode, modifiers: 0).isAcceptable)
        }
    }

    @Test func modifiedCombosNeverWarn() {
        #expect(!HotKeyCombo(keyCode: 50, modifiers: HotKeyCombo.option).swallowsTyping)
    }
}
