import Foundation

enum HarnessKind: String, Equatable, Sendable {
    case codex
    case claudeCode = "claude-code"
    case opencode
    case geminiCLI = "gemini-cli"
    case generic

    var displayName: String {
        switch self {
        case .codex:
            "Codex"
        case .claudeCode:
            "Claude Code"
        case .opencode:
            "OpenCode"
        case .geminiCLI:
            "Gemini CLI"
        case .generic:
            "Agent"
        }
    }

    var symbolName: String {
        switch self {
        case .codex:
            "terminal"
        case .claudeCode:
            "sparkles"
        case .opencode:
            "curlybraces.square"
        case .geminiCLI:
            "diamond.fill"
        case .generic:
            "cpu"
        }
    }
}

enum HostKind: String, Equatable, Sendable {
    case terminal
    case codexApp = "codex-app"
    case warp
    case browser
    case unknown
}

enum NotchUrgency: Equatable, Sendable {
    case active
    case blocked
    case quiet

    var badgeLabel: String {
        switch self {
        case .active:
            "Live"
        case .blocked:
            "Block"
        case .quiet:
            "Quiet"
        }
    }
}

struct SourceIdentity: Equatable, Sendable {
    let harness: HarnessKind
    let host: HostKind
    let activeThreadCount: Int
}

struct NotchInterruptPayload: Identifiable, Equatable, Sendable {
    let id: String
    let source: SourceIdentity
    let queueCount: Int
    let urgency: NotchUrgency
    let title: String
    let summary: String
    let recommendation: String
    let alternate: String
    let workspaceTitle: String
}
