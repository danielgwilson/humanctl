import Foundation

@MainActor
final class NotchShellStateMachine {
    enum Event {
        case bootstrap(hasPayload: Bool)
        case payloadAvailabilityChanged(Bool)
        case requestOpen(NotchOpenReason)
        case requestClose(NotchCloseReason)
        case togglePinnedOpen(NotchOpenReason)
    }

    private(set) var state: NotchShellState {
        didSet {
            onStateChange?(state)
        }
    }

    var onStateChange: ((NotchShellState) -> Void)?

    private var hasPayload = false

    init() {
        self.state = .hidden
    }

    func send(_ event: Event) {
        switch event {
        case .bootstrap(let hasPayload):
            self.hasPayload = hasPayload
            state = hasPayload ? ambientState(from: state) : .hidden

        case .payloadAvailabilityChanged(let isAvailable):
            hasPayload = isAvailable

            guard isAvailable else {
                state = .hidden
                return
            }

            if state.phase == .hidden {
                state = ambientState(from: state)
            }

        case .requestOpen(let reason):
            open(reason: reason, pinned: true)

        case .requestClose:
            closeToAmbient()

        case .togglePinnedOpen(let reason):
            togglePinnedOpen(reason: reason)
        }
    }

    private func open(reason: NotchOpenReason, pinned: Bool) {
        guard hasPayload else {
            state = .hidden
            return
        }

        state.phase = .expanded
        state.isPinnedOpen = pinned
        state.lastOpenReason = reason
    }

    private func closeToAmbient() {
        state = hasPayload ? ambientState(from: state) : .hidden
    }

    private func togglePinnedOpen(reason: NotchOpenReason) {
        guard hasPayload else {
            state = .hidden
            return
        }

        switch state.phase {
        case .hidden, .ambient:
            open(reason: reason, pinned: true)

        case .expanded:
            if state.isPinnedOpen {
                closeToAmbient()
            } else {
                state.isPinnedOpen = true
                state.lastOpenReason = reason
            }
        }
    }

    private func ambientState(from state: NotchShellState) -> NotchShellState {
        NotchShellState(
            phase: .ambient,
            isPinnedOpen: false,
            lastOpenReason: state.lastOpenReason
        )
    }
}
