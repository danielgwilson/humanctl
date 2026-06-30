import AppKit
import Carbon.HIToolbox
import Foundation

final class HumanctlHotKeyManager {
    private static let signature = OSType(0x4843544C)
    private let hotKeyID = EventHotKeyID(signature: signature, id: 1)
    private let action: @Sendable () -> Void

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?

    init(action: @escaping @Sendable () -> Void) {
        self.action = action
    }

    deinit {
        unregister()
    }

    func registerDefaultHotKey() {
        unregister()

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let userData = Unmanaged.passUnretained(self).toOpaque()
        let installStatus = InstallEventHandler(
            GetEventDispatcherTarget(),
            Self.hotKeyEventHandler,
            1,
            &eventType,
            userData,
            &eventHandlerRef
        )

        guard installStatus == noErr else {
            return
        }

        let registerStatus = RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(optionKey),
            hotKeyID,
            GetEventDispatcherTarget(),
            0,
            &hotKeyRef
        )

        if registerStatus != noErr {
            unregister()
        }
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }

        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
    }

    private func handleHotKeyPressed(for event: EventRef?) {
        guard let event else {
            return
        }

        var pressedHotKeyID = EventHotKeyID()
        let status = GetEventParameter(
            event,
            EventParamName(kEventParamDirectObject),
            EventParamType(typeEventHotKeyID),
            nil,
            MemoryLayout<EventHotKeyID>.size,
            nil,
            &pressedHotKeyID
        )

        guard status == noErr,
              pressedHotKeyID.signature == hotKeyID.signature,
              pressedHotKeyID.id == hotKeyID.id else {
            return
        }

        action()
    }

    private static let hotKeyEventHandler: EventHandlerUPP = { _, event, userData in
        guard let userData else {
            return noErr
        }

        let manager = Unmanaged<HumanctlHotKeyManager>.fromOpaque(userData).takeUnretainedValue()
        manager.handleHotKeyPressed(for: event)
        return noErr
    }
}
