import Foundation

enum NotchShellPhase: Equatable, Sendable {
    case hidden
    case ambient
    case expanded
}

enum NotchOpenReason: Equatable, Sendable {
    case statusItem
    case action
    case hotKey
}

enum NotchCloseReason: Equatable, Sendable {
    case statusItem
    case outsideClick
    case escapeKey
    case action
    case payloadUnavailable
}

struct NotchShellState: Equatable, Sendable {
    var phase: NotchShellPhase
    var isPinnedOpen: Bool
    var lastOpenReason: NotchOpenReason?

    static let hidden = NotchShellState(
        phase: .hidden,
        isPinnedOpen: false,
        lastOpenReason: nil
    )
}

struct NotchAmbientModel: Equatable, Sendable {
    let harnessSymbolName: String
    let sourceLabel: String
    let sourceCountLabel: String?
    let queueCountLabel: String
    let urgencyLabel: String
    let urgency: NotchUrgency
}

struct NotchPeekModel: Equatable, Sendable {
    let harnessSymbolName: String
    let sourceLabel: String
    let queueCountLabel: String
    let urgency: NotchUrgency
    let title: String
    let summary: String
    let recommendation: String
    let alternate: String
    let workspaceTitle: String
    let urgencyLabel: String
}

struct NotchShellSnapshot: Equatable, Sendable {
    let state: NotchShellState
    let payload: NotchInterruptPayload?

    var ambientModel: NotchAmbientModel? {
        guard let payload else {
            return nil
        }

        let queueLabel = payload.queueCount == 1 ? "1" : "\(payload.queueCount)"
        let sourceCountLabel = payload.source.activeThreadCount > 1 ? "\(payload.source.activeThreadCount)" : nil

        return NotchAmbientModel(
            harnessSymbolName: payload.source.harness.symbolName,
            sourceLabel: payload.source.harness.displayName,
            sourceCountLabel: sourceCountLabel,
            queueCountLabel: queueLabel,
            urgencyLabel: payload.urgency.badgeLabel,
            urgency: payload.urgency
        )
    }

    var peekModel: NotchPeekModel? {
        guard let payload else {
            return nil
        }

        let queueLabel = payload.queueCount == 1 ? "1 waiting" : "\(payload.queueCount) waiting"

        return NotchPeekModel(
            harnessSymbolName: payload.source.harness.symbolName,
            sourceLabel: payload.source.harness.displayName,
            queueCountLabel: queueLabel,
            urgency: payload.urgency,
            title: payload.title,
            summary: payload.summary,
            recommendation: payload.recommendation,
            alternate: payload.alternate,
            workspaceTitle: payload.workspaceTitle,
            urgencyLabel: payload.urgency.badgeLabel
        )
    }
}
