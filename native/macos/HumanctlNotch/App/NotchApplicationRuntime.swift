import Combine
import AppKit
import Foundation

@MainActor
final class NotchApplicationRuntime: ObservableObject {
    static let shared = NotchApplicationRuntime()

    let shellStore: NotchShellStore
    let panelController: NotchHostPanelController
    @Published private(set) var menuBarTitle = "humanctl"

    private lazy var hotKeyManager = HumanctlHotKeyManager { [weak self] in
        Task { @MainActor [weak self] in
            self?.togglePeekFromHotKey()
        }
    }
    private var cancellables = Set<AnyCancellable>()
    private var isStarted = false

    private init() {
        let payloadSource = SampleNotchPayloadSource()
        let shellStore = NotchShellStore(payloadSource: payloadSource)

        self.shellStore = shellStore
        self.panelController = NotchHostPanelController(store: shellStore)

        bind()
    }

    func start() {
        guard !isStarted else {
            return
        }

        isStarted = true
        shellStore.start()
        panelController.start()
        hotKeyManager.registerDefaultHotKey()
    }

    func stop() {
        guard isStarted else {
            return
        }

        isStarted = false
        hotKeyManager.unregister()
        panelController.stop()
    }

    func toggleNotch() {
        togglePeek()
    }

    func togglePeek() {
        shellStore.togglePinnedOpen(reason: .statusItem)
    }

    func togglePeekFromHotKey() {
        shellStore.togglePinnedOpen(reason: .hotKey)
    }

    private func bind() {
        shellStore.$snapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                guard let self else {
                    return
                }

                if let ambient = snapshot.ambientModel {
                    self.menuBarTitle = "humanctl, \(ambient.queueCountLabel) waiting from \(ambient.sourceLabel)"
                } else {
                    self.menuBarTitle = "humanctl"
                }
            }
            .store(in: &cancellables)
    }
}
