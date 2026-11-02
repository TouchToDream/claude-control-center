// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ClaudeControlCenter",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ClaudeControlCenter", targets: ["ClaudeControlCenter"]),
    ],
    targets: [
        .target(name: "ControlCenterCore"),
        .executableTarget(
            name: "ClaudeControlCenter",
            dependencies: ["ControlCenterCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(name: "ControlCenterCoreTests", dependencies: ["ControlCenterCore"]),
    ]
)
