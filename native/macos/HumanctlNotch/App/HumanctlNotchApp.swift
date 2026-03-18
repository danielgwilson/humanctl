import SwiftUI

@main
struct HumanctlNotchApp: App {
    @NSApplicationDelegateAdaptor(HumanctlNotchAppDelegate.self) private var appDelegate
    @StateObject private var runtime = NotchApplicationRuntime.shared

    var body: some Scene {
        MenuBarExtra {
            Button("Toggle Notch") {
                performMenuAction {
                    runtime.toggleNotch()
                }
            }

            Divider()

            Button("Quit HumanctlNotch", role: .destructive) {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q", modifiers: .command)
        } label: {
            Text(runtime.menuBarTitle)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
        }

        Settings {
            EmptyView()
        }
    }

    private func performMenuAction(_ action: @escaping @MainActor () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            Task { @MainActor in
                action()
            }
        }
    }
}
