import Foundation

enum NotchShellPhase: Equatable, Sendable {
    case hidden
    case ambient
    case expanded
}

enum NotchHoverRegion: Equatable, Sendable {
    case none
    case ambient
    case expanded
}

enum NotchOpenReason: Equatable, Sendable {
    case hover
    case statusItem
    case action
}

enum NotchCloseReason: Equatable, Sendable {
    case hoverExit
    case statusItem
    case outsideClick
    case escapeKey
    case action
    case payloadUnavailable
}

struct NotchShellState: Equatable, Sendable {
    var phase: NotchShellPhase
    var hoverRegion: NotchHoverRegion
    var isPinnedOpen: Bool
    var lastOpenReason: NotchOpenReason?

    static let hidden = NotchShellState(
        phase: .hidden,
        hoverRegion: .none,
        isPinnedOpen: false,
        lastOpenReason: nil
    )
}

struct NotchAmbientModel: Equatable, Sendable {
    let queueLabel: String
}

struct NotchShellSnapshot: Equatable, Sendable {
    let state: NotchShellState
    let payload: NotchInterruptPayload?

    var ambientModel: NotchAmbientModel? {
        guard let payload else {
            return nil
        }

        let queueLabel = payload.queueCount == 1 ? "1 item" : "\(payload.queueCount) items"
        return NotchAmbientModel(queueLabel: queueLabel)
    }
}
