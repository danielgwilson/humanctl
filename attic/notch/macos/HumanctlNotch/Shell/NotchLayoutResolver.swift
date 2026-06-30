import AppKit

struct NotchLayoutResolver {
    func frame(for phase: NotchShellPhase, on screen: NSScreen?) -> NSRect? {
        guard let screen else {
            return nil
        }

        let notchFrame = screen.notchFrame

        switch phase {
        case .hidden:
            return nil

        case .ambient:
            let width = min(
                NotchShellMetrics.ambientMaximumWidth,
                max(NotchShellMetrics.ambientMinimumWidth, notchFrame.width + NotchShellMetrics.ambientTotalShoulderWidth)
            )
            let originX = screen.notchCenterX - (width / 2)
            let height = notchFrame.height + NotchShellMetrics.ambientInteractionChinHeight
            let originY = screen.frame.maxY - height
            return NSRect(x: originX, y: originY, width: width, height: height)

        case .expanded:
            let width = NotchShellMetrics.expandedVisibleWidth
            let height = NotchShellMetrics.expandedHostHeight
            let originX = screen.notchCenterX - (width / 2)
            let originY = screen.frame.maxY - height

            return NSRect(x: originX, y: originY, width: width, height: height)
        }
    }

    func interactionRect(for phase: NotchShellPhase, on screen: NSScreen?) -> NSRect? {
        guard let frame = frame(for: phase, on: screen) else {
            return nil
        }

        switch phase {
        case .hidden:
            return nil
        case .ambient:
            return frame
        case .expanded:
            return frame.insetBy(dx: -10, dy: -6)
        }
    }
}
