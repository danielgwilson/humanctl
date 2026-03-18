import Combine
import Foundation

@MainActor
final class NotchApplicationRuntime: ObservableObject {
    static let shared = NotchApplicationRuntime()

    let shellStore: NotchShellStore
    let panelController: NotchHostPanelController
    @Published private(set) var menuBarTitle = "HCTL"

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
    }

    func stop() {
        guard isStarted else {
            return
        }

        isStarted = false
        panelController.stop()
    }

    func toggleNotch() {
        shellStore.togglePinnedOpenFromStatusItem()
    }

    private func bind() {
        shellStore.$snapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                guard let self else {
                    return
                }

                if let ambient = snapshot.ambientModel {
                    let marker = snapshot.state.phase == .expanded ? " •" : ""
                    self.menuBarTitle = "HCTL \(ambient.queueLabel)\(marker)"
                } else {
                    self.menuBarTitle = "HCTL"
                }
            }
            .store(in: &cancellables)
    }
}
