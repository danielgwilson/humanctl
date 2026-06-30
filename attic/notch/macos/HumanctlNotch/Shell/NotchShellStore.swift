import Combine
import Foundation

@MainActor
final class NotchShellStore: ObservableObject {
    @Published private(set) var snapshot: NotchShellSnapshot

    private let payloadSource: SampleNotchPayloadSource
    private let stateMachine: NotchShellStateMachine
    private var cancellables = Set<AnyCancellable>()

    init(
        payloadSource: SampleNotchPayloadSource,
        stateMachine: NotchShellStateMachine = NotchShellStateMachine()
    ) {
        self.payloadSource = payloadSource
        self.stateMachine = stateMachine
        self.snapshot = NotchShellSnapshot(
            state: stateMachine.state,
            payload: payloadSource.activePayload
        )

        bind()
    }

    func start() {
        payloadSource.start()
        stateMachine.send(.bootstrap(hasPayload: payloadSource.activePayload != nil))
        rebuildSnapshot()
    }

    func openFromAction() {
        stateMachine.send(.requestOpen(.action))
    }

    func togglePinnedOpen(reason: NotchOpenReason = .statusItem) {
        stateMachine.send(.togglePinnedOpen(reason))
    }

    func dismissExpanded(_ reason: NotchCloseReason = .action) {
        stateMachine.send(.requestClose(reason))
    }

    private func bind() {
        stateMachine.onStateChange = { [weak self] _ in
            self?.rebuildSnapshot()
        }

        payloadSource.$activePayload
            .receive(on: RunLoop.main)
            .sink { [weak self] payload in
                guard let self else {
                    return
                }

                self.stateMachine.send(.payloadAvailabilityChanged(payload != nil))
                self.rebuildSnapshot()
            }
            .store(in: &cancellables)
    }

    private func rebuildSnapshot() {
        snapshot = NotchShellSnapshot(
            state: stateMachine.state,
            payload: payloadSource.activePayload
        )
    }
}
