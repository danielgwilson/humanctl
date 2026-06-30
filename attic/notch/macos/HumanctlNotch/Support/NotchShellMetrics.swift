import SwiftUI

enum NotchShellMetrics {
    static let closedTopCornerRadius: CGFloat = 6
    static let closedBottomCornerRadius: CGFloat = 16
    static let openTopCornerRadius: CGFloat = 19
    static let openBottomCornerRadius: CGFloat = 24

    static let ambientTotalShoulderWidth: CGFloat = 176
    static let ambientMinimumWidth: CGFloat = 268
    static let ambientMaximumWidth: CGFloat = 388
    static let ambientInteractionChinHeight: CGFloat = 10
    static let ambientShoulderInset: CGFloat = 18
    static let ambientShoulderSpacing: CGFloat = 10
    static let ambientHeaderOpticalOffset: CGFloat = -2.5

    static let expandedVisibleWidth: CGFloat = 640
    static let expandedVisibleHeight: CGFloat = 190
    static let expandedHostHeight: CGFloat = 226
    static let expandedHorizontalEdgeInset: CGFloat = 12
    static let expandedBottomContentPadding: CGFloat = 24
    static let expandedOuterBottomPadding: CGFloat = 20

    static let shellSpring = Animation.interactiveSpring(response: 0.38, dampingFraction: 0.8, blendDuration: 0)
    static let panelAnimationDuration: TimeInterval = 0.22
}
