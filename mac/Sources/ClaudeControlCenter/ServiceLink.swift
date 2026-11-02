import ControlCenterCore
import Foundation

final class ServiceLink: NSObject, URLSessionWebSocketDelegate {
    var onReachable: ((Bool) -> Void)?
    var onUnread: (([AlertItem]) -> Void)?
    var onAlert: ((AlertItem) -> Void)?

    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var task: URLSessionWebSocketTask?
    private var attempt = 0
    private var isReachable: Bool?

    func start() {
        connect()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else {
            return
        }

        attempt = 0
        setReachable(true)
        webSocketTask.send(.string(#"{"type":"hello","client":"mac-app"}"#)) { _ in }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        drop(webSocketTask)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        drop(task)
    }

    private func connect() {
        guard let config = try? ServiceConfig.load(), let url = URL(string: "ws://127.0.0.1:\(config.port)/ws") else {
            setReachable(false)
            scheduleReconnect()

            return
        }

        var request = URLRequest(url: url)

        request.setValue("ccc_key=\(config.key)", forHTTPHeaderField: "Cookie")
        request.setValue("http://127.0.0.1:\(config.port)", forHTTPHeaderField: "Origin")

        let created = session.webSocketTask(with: request)

        created.maximumMessageSize = 32 * 1024 * 1024
        task = created
        created.resume()
        receive(on: created)
    }

    private func receive(on current: URLSessionWebSocketTask) {
        current.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, current === self.task else {
                    return
                }

                switch result {
                case .success(.string(let text)):
                    self.handle(ServiceEvent.decode(Data(text.utf8)))
                    self.receive(on: current)
                case .success(.data(let data)):
                    self.handle(ServiceEvent.decode(data))
                    self.receive(on: current)
                case .success:
                    self.receive(on: current)
                case .failure:
                    self.drop(current)
                }
            }
        }
    }

    private func handle(_ event: ServiceEvent) {
        switch event {
        case .state(let unread):
            onUnread?(unread)
        case .alert(let alert):
            onAlert?(alert)
        case .other:
            break
        }
    }

    private func drop(_ dropped: URLSessionTask) {
        guard dropped === task else {
            return
        }

        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        setReachable(false)
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        let delay = retryDelay(attempt: attempt)

        attempt += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            if self?.task == nil {
                self?.connect()
            }
        }
    }

    private func setReachable(_ reachable: Bool) {
        if reachable != isReachable {
            isReachable = reachable
            onReachable?(reachable)
        }
    }
}
