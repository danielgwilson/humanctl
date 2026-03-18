import Foundation

@MainActor
final class NotchShellStateMachine {
    struct Configuration {
        let hoverOpenDelay: Duration
        let hoverCloseDelay: Duration

        static let `default` = Configuration(
            hoverOpenDelay: .milliseconds(180),
            hoverCloseDelay: .milliseconds(320)
        )
    }

    enum Event {
        case bootstrap(hasPayload: Bool)
        case payloadAvailabilityChanged(Bool)
        case hoverChanged(region: NotchHoverRegion, isHovering: Bool)
        case requestOpen(NotchOpenReason)
        case requestClose(NotchCloseReason)
        case togglePinnedOpen
    }

    private(set) var state: NotchShellState {
        didSet {
            onStateChange?(state)
        }
    }

    var onStateChange: ((NotchShellState) -> Void)?

    private let configuration: Configuration
    private var hasPayload = false
    private var pendingOpenTask: Task<Void, Never>?
    private var pendingCloseTask: Task<Void, Never>?

    init(configuration: Configuration = .default) {
        self.configuration = configuration
        self.state = .hidden
    }

    deinit {
        pendingOpenTask?.cancel()
        pendingCloseTask?.cancel()
    }

    func send(_ event: Event) {
        switch event {
        case .bootstrap(let hasPayload):
            self.hasPayload = hasPayload
            cancelPendingTasks()
            state = hasPayload ? ambientState(from: state) : .hidden

        case .payloadAvailabilityChanged(let isAvailable):
            hasPayload = isAvailable

            guard isAvailable else {
                cancelPendingTasks()
                state = .hidden
                return
            }

            if state.phase == .hidden {
                state = ambientState(from: state)
            }

        case .hoverChanged(let region, let isHovering):
            handleHoverChange(region: region, isHovering: isHovering)

        case .requestOpen(let reason):
            open(reason: reason, pinned: reason != .hover)

        case .requestClose:
            closeToAmbient()

        case .togglePinnedOpen:
            togglePinnedOpen()
        }
    }

    private func handleHoverChange(region: NotchHoverRegion, isHovering: Bool) {
        if isHovering {
            pendingCloseTask?.cancel()
            state.hoverRegion = region

            if region == .ambient, state.phase == .ambient {
                scheduleHoverOpen()
            }
        } else {
            if state.hoverRegion == region {
                state.hoverRegion = .none
            }

            if region == .ambient {
                pendingOpenTask?.cancel()
            }

            if region == .expanded, state.phase == .expanded, !state.isPinnedOpen {
                scheduleHoverClose()
            }
        }
    }

    private func scheduleHoverOpen() {
        pendingOpenTask?.cancel()
        pendingOpenTask = Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            try? await Task.sleep(for: configuration.hoverOpenDelay)
            guard !Task.isCancelled else {
                return
            }

            guard hasPayload, state.phase == .ambient, state.hoverRegion == .ambient else {
                return
            }

            open(reason: .hover, pinned: false)
        }
    }

    private func scheduleHoverClose() {
        pendingCloseTask?.cancel()
        pendingCloseTask = Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            try? await Task.sleep(for: configuration.hoverCloseDelay)
            guard !Task.isCancelled else {
                return
            }

            guard state.phase == .expanded, !state.isPinnedOpen, state.hoverRegion != .expanded else {
                return
            }

            closeToAmbient()
        }
    }

    private func open(reason: NotchOpenReason, pinned: Bool) {
        guard hasPayload else {
            state = .hidden
            return
        }

        cancelPendingTasks()
        state.phase = .expanded
        state.isPinnedOpen = pinned
        state.lastOpenReason = reason
    }

    private func closeToAmbient() {
        cancelPendingTasks()
        state = hasPayload ? ambientState(from: state) : .hidden
    }

    private func togglePinnedOpen() {
        guard hasPayload else {
            state = .hidden
            return
        }

        cancelPendingTasks()

        switch state.phase {
        case .hidden, .ambient:
            open(reason: .statusItem, pinned: true)

        case .expanded:
            if state.isPinnedOpen {
                closeToAmbient()
            } else {
                state.isPinnedOpen = true
                state.lastOpenReason = .statusItem
            }
        }
    }

    private func ambientState(from state: NotchShellState) -> NotchShellState {
        NotchShellState(
            phase: .ambient,
            hoverRegion: state.hoverRegion == .expanded ? .none : state.hoverRegion,
            isPinnedOpen: false,
            lastOpenReason: state.lastOpenReason
        )
    }

    private func cancelPendingTasks() {
        pendingOpenTask?.cancel()
        pendingCloseTask?.cancel()
        pendingOpenTask = nil
        pendingCloseTask = nil
    }
}
