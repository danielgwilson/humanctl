import AppKit
import CoreGraphics

extension NSScreen {
    var displayUUID: String? {
        guard let number = deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }

        let displayID = CGDirectDisplayID(number.uint32Value)
        guard let uuid = CGDisplayCreateUUIDFromDisplayID(displayID) else {
            return nil
        }

        return CFUUIDCreateString(nil, uuid.takeRetainedValue()) as String
    }

    var menuBarBandHeight: CGFloat {
        let menuBarHeight = frame.maxY - visibleFrame.maxY
        return max(24, menuBarHeight)
    }

    var hasPhysicalNotch: Bool {
        safeAreaInsets.top > 0 && auxiliaryTopLeftArea != nil && auxiliaryTopRightArea != nil
    }

    var notchSize: CGSize {
        let height = hasPhysicalNotch ? safeAreaInsets.top : menuBarBandHeight

        guard
            let topLeftInset = auxiliaryTopLeftArea?.width,
            let topRightInset = auxiliaryTopRightArea?.width
        else {
            return CGSize(width: 185, height: height)
        }

        let width = max(160, frame.width - topLeftInset - topRightInset + 4)
        return CGSize(width: width, height: max(24, height))
    }

    var notchCenterX: CGFloat {
        guard
            let topLeftInset = auxiliaryTopLeftArea?.width,
            let topRightInset = auxiliaryTopRightArea?.width
        else {
            return frame.midX
        }

        let visibleNotchWidth = frame.width - topLeftInset - topRightInset
        return frame.minX + topLeftInset + (visibleNotchWidth / 2)
    }

    var notchFrame: CGRect {
        let size = notchSize
        return CGRect(
            x: notchCenterX - (size.width / 2),
            y: frame.maxY - size.height,
            width: size.width,
            height: size.height
        )
    }

    @MainActor
    static func screen(withUUID uuid: String) -> NSScreen? {
        screens.first { $0.displayUUID == uuid }
    }

    static var screenContainingMouse: NSScreen? {
        let mouseLocation = NSEvent.mouseLocation
        return screens.first { NSMouseInRect(mouseLocation, $0.frame, false) }
    }
}
