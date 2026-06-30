import AppKit

@MainActor
final class HumanctlNotchAppDelegate: NSObject, NSApplicationDelegate {
    private let runtime = NotchApplicationRuntime.shared

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        runtime.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        runtime.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
