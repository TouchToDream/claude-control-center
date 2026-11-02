import CoreGraphics

public struct WindowLayout: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public static let initial = WindowLayout(x: 0.5, y: 0, width: 0.5, height: 1)

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public static func from(frame: CGRect, in visible: CGRect) -> WindowLayout {
        WindowLayout(
            x: (frame.minX - visible.minX) / visible.width,
            y: (frame.minY - visible.minY) / visible.height,
            width: frame.width / visible.width,
            height: frame.height / visible.height
        )
    }

    public func frame(in visible: CGRect, minimum: CGSize = CGSize(width: 420, height: 360)) -> CGRect {
        let width = min(max(width * visible.width, minimum.width), visible.width)
        let height = min(max(height * visible.height, minimum.height), visible.height)
        let left = min(max(visible.minX + x * visible.width, visible.minX), visible.maxX - width)
        let bottom = min(max(visible.minY + y * visible.height, visible.minY), visible.maxY - height)

        return CGRect(x: left, y: bottom, width: width, height: height)
    }
}
