import Foundation

struct NotchInterruptPayload: Identifiable, Equatable, Sendable {
    let id: String
    let queueCount: Int
}
