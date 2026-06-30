import AppKit

final class NotchHostPanel: NSPanel {
    override init(
        contentRect: NSRect,
        styleMask style: NSWindow.StyleMask,
        backing backingStoreType: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(
            contentRect: contentRect,
            styleMask: style,
            backing: backingStoreType,
            defer: flag
        )

        isFloatingPanel = true
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isMovable = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        level = .mainMenu + 2
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        sharingType = .none
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    }

    override var canBecomeKey: Bool {
        false
    }

    override var canBecomeMain: Bool {
        false
    }
}
