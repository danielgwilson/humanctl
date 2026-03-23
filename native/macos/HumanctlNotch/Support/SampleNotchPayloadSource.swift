import Combine
import Foundation

@MainActor
final class SampleNotchPayloadSource: ObservableObject {
    @Published private(set) var activePayload: NotchInterruptPayload?

    func start() {
        guard activePayload == nil else {
            return
        }

        activePayload = NotchInterruptPayload(
            id: "shell-baseline",
            source: SourceIdentity(
                harness: .codex,
                host: .terminal,
                activeThreadCount: 3
            ),
            queueCount: 2,
            urgency: .blocked,
            title: "Ship the launch copy revision?",
            summary: "The homepage draft is ready, but the worker is blocked on your taste call before publishing.",
            recommendation: "Ship tighter copy",
            alternate: "Keep the safer line",
            workspaceTitle: "Open source thread"
        )
    }
}
