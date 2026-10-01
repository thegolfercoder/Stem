// swift-tools-version: 5.9
// The swing analysis itself, in plain Swift: features, the event network, the
// ordered decoder, the measurements and their error bands. No UI and no Apple-only
// frameworks, so it builds and is tested on Linux as well as in the iPhone app.
import PackageDescription

let package = Package(
    name: "SwingCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SwingCore", targets: ["SwingCore"])],
    targets: [
        .target(name: "SwingCore", resources: [.copy("Resources/model.json")]),
        .testTarget(
            name: "SwingCoreTests",
            dependencies: ["SwingCore"],
            resources: [.copy("Resources")]
        ),
    ]
)
