import AppKit
import ControlCenterCore
import WebKit

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

final class WebPanel: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let view: WKWebView

    private var config: ServiceConfig?
    private var isReady = false
    private var isShown = false
    private var pending: [String] = []
    private var attempt = 0
    private var retry: DispatchWorkItem?

    override init() {
        let configuration = WKWebViewConfiguration()
        let relay = WeakMessageHandler()

        configuration.websiteDataStore = .default()
        configuration.userContentController.add(relay, name: "ccc")
        view = WKWebView(frame: .zero, configuration: configuration)

        super.init()

        relay.target = self
        view.navigationDelegate = self
        view.uiDelegate = self
    }

    func load() {
        retry?.cancel()
        isReady = false
        config = try? ServiceConfig.load()

        guard let config, var components = URLComponents(url: config.baseURL, resolvingAgainstBaseURL: false) else {
            scheduleRetry()

            return
        }

        components.path = "/"
        components.queryItems = [URLQueryItem(name: "key", value: config.key)]

        if let url = components.url {
            view.load(URLRequest(url: url))
        }
    }

    func setShown(_ shown: Bool) {
        isShown = shown
        call("window.cccApp?.setShown(\(shown))")
    }

    func show(sessionId: String?, onlyIfNoDraft: Bool) {
        call("window.cccApp?.show(\(jsonLiteral(sessionId)), \(onlyIfNoDraft))")
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "ready" else {
            return
        }

        isReady = true
        view.evaluateJavaScript("window.cccApp?.setShown(\(isShown))")
        pending.forEach { view.evaluateJavaScript($0) }
        pending = []
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        attempt = 0
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        scheduleRetry()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        scheduleRetry()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)

            return
        }

        if isOwn(url) {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }

        return nil
    }

    private func isOwn(_ url: URL) -> Bool {
        url.scheme == "about" || (url.host == "127.0.0.1" && url.port == config?.port)
    }

    private func call(_ script: String) {
        if isReady {
            view.evaluateJavaScript(script)
        } else if !script.contains("setShown") {
            pending.append(script)
        }
    }

    private func scheduleRetry() {
        let work = DispatchWorkItem { [weak self] in
            self?.load()
        }

        retry?.cancel()
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + retryDelay(attempt: attempt), execute: work)
        attempt += 1
    }

    private func jsonLiteral(_ value: String?) -> String {
        guard let value, let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) else {
            return "null"
        }

        return text
    }
}
