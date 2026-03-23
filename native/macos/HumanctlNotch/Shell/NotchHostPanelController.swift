import AppKit
import Combine
import SwiftUI

@MainActor
final class NotchHostPanelController {
    private let store: NotchShellStore
    private let layoutResolver = NotchLayoutResolver()
    private let panel: NotchHostPanel
    private let hostingController: NSHostingController<NotchShellRootView>
    private var anchoredScreenUUID: String?

    private var cancellables = Set<AnyCancellable>()
    private var globalClickMonitor: Any?
    private var localEventMonitor: Any?
    private var observers: [NSObjectProtocol] = []
    private var currentInteractionRect: NSRect?

    init(store: NotchShellStore) {
        self.store = store
        self.hostingController = NSHostingController(rootView: NotchShellRootView(store: store))
        self.panel = NotchHostPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        panel.contentViewController = hostingController

        bind()
        installObservers()
    }

    func start() {
        render(snapshot: store.snapshot)
    }

    func stop() {
        removeInteractionMonitors()
        removeObservers()
        panel.orderOut(nil)
    }

    private func bind() {
        store.$snapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                self?.render(snapshot: snapshot)
            }
            .store(in: &cancellables)
    }

    private func installObservers() {
        observers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didChangeScreenParametersNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else {
                        return
                    }

                    self.render(snapshot: self.store.snapshot)
                }
            }
        )

        observers.append(
            NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.activeSpaceDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else {
                        return
                    }

                    self.render(snapshot: self.store.snapshot)
                }
            }
        )
    }

    private func render(snapshot: NotchShellSnapshot) {
        if snapshot.state.phase == .hidden {
            anchoredScreenUUID = nil
        }

        let screen = targetScreen()
        guard let frame = layoutResolver.frame(for: snapshot.state.phase, on: screen) else {
            removeInteractionMonitors()
            currentInteractionRect = nil
            panel.orderOut(nil)
            return
        }

        panel.hasShadow = false

        if snapshot.state.phase == .expanded {
            installInteractionMonitors()
        } else {
            removeInteractionMonitors()
        }

        currentInteractionRect = layoutResolver.interactionRect(for: snapshot.state.phase, on: screen)
        present(frame: frame)
    }

    private func present(frame: NSRect) {
        if !panel.isVisible {
            panel.setFrame(frame, display: true)
            panel.orderFront(nil)
            panel.alphaValue = 1
            return
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = NotchShellMetrics.panelAnimationDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(frame, display: true)
        }
    }

    private func installInteractionMonitors() {
        guard globalClickMonitor == nil, localEventMonitor == nil else {
            return
        }

        globalClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.dismissIfPointerOutsidePanel()
            }
        }

        localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                if event.type == .keyDown, event.keyCode == 53 {
                    self.store.dismissExpanded(.escapeKey)
                    return
                }

                self.dismissIfPointerOutsidePanel()
            }

            return event
        }
    }

    private func removeInteractionMonitors() {
        if let globalClickMonitor {
            NSEvent.removeMonitor(globalClickMonitor)
            self.globalClickMonitor = nil
        }

        if let localEventMonitor {
            NSEvent.removeMonitor(localEventMonitor)
            self.localEventMonitor = nil
        }
    }

    private func removeObservers() {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }

        observers.removeAll()
    }

    private func dismissIfPointerOutsidePanel() {
        guard store.snapshot.state.phase == .expanded else {
            return
        }

        let pointerLocation = NSEvent.mouseLocation
        let interactionRect = currentInteractionRect ?? panel.frame
        guard !interactionRect.contains(pointerLocation) else {
            return
        }

        store.dismissExpanded(.outsideClick)
    }

    private func targetScreen() -> NSScreen? {
        if let anchoredScreenUUID, let anchoredScreen = NSScreen.screen(withUUID: anchoredScreenUUID) {
            return anchoredScreen
        }

        let screen = NSScreen.screenContainingMouse ?? NSScreen.main ?? NSScreen.screens.first
        anchoredScreenUUID = screen?.displayUUID
        return screen
    }
}
