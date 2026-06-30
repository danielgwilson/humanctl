import SwiftUI

@main
struct HumanctlNotchApp: App {
    @NSApplicationDelegateAdaptor(HumanctlNotchAppDelegate.self) private var appDelegate
    @StateObject private var runtime = NotchApplicationRuntime.shared

    var body: some Scene {
        MenuBarExtra {
            Button("Toggle Notch") {
                performMenuAction {
                    runtime.togglePeek()
                }
            }

            Divider()

            Button("Quit humanctl", role: .destructive) {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q", modifiers: .command)
        } label: {
            Image(systemName: "circle.grid.2x2.fill")
                .symbolRenderingMode(.monochrome)
                .font(.system(size: 12, weight: .semibold))
                .accessibilityLabel(Text(runtime.menuBarTitle))
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
