import Foundation
import Testing
@testable import ControlCenterCore

private func alert(_ id: String, session: String?, at createdAt: Double) -> AlertItem {
    AlertItem(id: id, sessionId: session, event: "done", title: "api · Панель", body: "завершила роботу", createdAt: createdAt)
}

struct AlertsTests {
    @Test func newestAlertAfterHiding() {
        let unread = [alert("a", session: "s1", at: 300), alert("b", session: "s2", at: 500), alert("c", session: "s3", at: 100)]

        #expect(sessionToOpen(hiddenAt: 200, unread: unread) == "s2")
    }

    @Test func nothingBeforeHiding() {
        #expect(sessionToOpen(hiddenAt: 600, unread: [alert("a", session: "s1", at: 300)]) == nil)
    }

    @Test func neverHiddenOpensNothing() {
        #expect(sessionToOpen(hiddenAt: nil, unread: [alert("a", session: "s1", at: 300)]) == nil)
    }

    @Test func limitAlertHasNoSession() {
        let unread = [alert("a", session: "s1", at: 300), alert("b", session: nil, at: 500)]

        #expect(sessionToOpen(hiddenAt: 200, unread: unread) == "s1")
    }

    @Test func badge() {
        #expect(badgeText(count: 0) == nil)
        #expect(badgeText(count: 3) == "3")
        #expect(badgeText(count: 99) == "99")
        #expect(badgeText(count: 120) == "99+")
    }

    @Test func menuCap() {
        let unread = (0..<25).map { alert("a\($0)", session: "s", at: Double($0)) }
        let menu = menuAlerts(unread)

        #expect(menu.shown.count == 10)
        #expect(menu.more == 15)
        #expect(menuAlerts(Array(unread.prefix(4))).more == 0)
    }

    @Test func decodeState() {
        let json = #"{"type":"state","state":{"sessions":[],"alerts":[{"id":"a","sessionId":"s1","event":"question","title":"api · Панель","body":"питає тебе","createdAt":1000}]}}"#

        #expect(ServiceEvent.decode(Data(json.utf8)) == .state(unread: [AlertItem(id: "a", sessionId: "s1", event: "question", title: "api · Панель", body: "питає тебе", createdAt: 1000)]))
    }

    @Test func decodeStateWithoutAlerts() {
        #expect(ServiceEvent.decode(Data(#"{"type":"state","state":{"sessions":[]}}"#.utf8)) == .state(unread: []))
    }

    @Test func decodeAlert() {
        let json = #"{"type":"alert","alert":{"id":"b","sessionId":null,"event":"limit","title":"Ліміт 5 годин","body":"використано 82%","createdAt":2000}}"#

        #expect(ServiceEvent.decode(Data(json.utf8)) == .alert(AlertItem(id: "b", sessionId: nil, event: "limit", title: "Ліміт 5 годин", body: "використано 82%", createdAt: 2000)))
    }

    @Test func decodeRowsIsOther() {
        #expect(ServiceEvent.decode(Data(#"{"type":"rows","rows":[]}"#.utf8)) == .other)
    }

    @Test func brokenJsonIsOther() {
        #expect(ServiceEvent.decode(Data("{nope".utf8)) == .other)
    }
}
