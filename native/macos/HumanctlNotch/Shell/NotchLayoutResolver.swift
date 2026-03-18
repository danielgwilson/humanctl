import AppKit

struct NotchLayoutResolver {
    private enum Metrics {
        static let expandedMinimumWidth: CGFloat = 360
        static let expandedMaximumWidth: CGFloat = 440
        static let expandedHeight: CGFloat = 152
    }

    func frame(for phase: NotchShellPhase, on screen: NSScreen?) -> NSRect? {
        guard let screen else {
            return nil
        }

        let notchFrame = screen.notchFrame

        switch phase {
        case .hidden:
            return nil

        case .ambient:
            return notchFrame

        case .expanded:
            let width = min(
                Metrics.expandedMaximumWidth,
                max(Metrics.expandedMinimumWidth, notchFrame.width + 132)
            )
            let height = Metrics.expandedHeight
            let originX = screen.notchCenterX - (width / 2)
            let originY = screen.frame.maxY - height

            return NSRect(x: originX, y: originY, width: width, height: height)
        }
    }
}
