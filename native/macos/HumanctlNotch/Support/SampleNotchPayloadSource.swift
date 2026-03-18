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
            queueCount: 2
        )
    }
}
