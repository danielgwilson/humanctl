# Notch Shell Contract

This is the current working contract for the native macOS notch spike.

It exists so we can preserve the shell behavior that finally worked before layering content back in.

The shell baseline here maps to the newer product vocabulary like this:

- current `compact` shell = future `Ambient` shell baseline
- current `expanded` shell = future `Peek` shell baseline

The deeper `Workspace` surface is outside this shell contract.

## Scope

This spike is only proving the notch shell UX.

It is not yet proving:

- real `.humanctl` integration
- artifact rendering
- answer capture
- context handoff
- notifications or presence policy

## Current Behavior

The native spike currently has exactly two shell states:

- compact
- expanded

Compact state:

- is anchored to the measured notch geometry
- is black only
- uses notch-height constraints
- shows only a tiny signal dot

Expanded state:

- grows from the same anchored shell
- remains black only
- does not attempt to render real product content yet

## Control Path

The app must always provide a normal Mac escape hatch.

Current rule:

- the menu bar extra is always visible as the primary control surface
- clicking it opens a standard menu
- the menu contains `Toggle Notch`
- the menu contains `Quit HumanctlNotch`

If quitting the app becomes awkward again, treat that as a serious regression.

## Geometry Rules

- derive notch geometry from display APIs, not screen-width guesses
- use one compact renderer only
- keep the anchor screen stable while the shell is visible
- treat the shell as one object across compact and expanded states
- do not use the full transparent host frame as the interaction region

## Visual Rules

For the current spike:

- no gradients
- no borders
- no shadows
- no pills
- no banner styling
- no mini-dashboard content

If a future iteration needs richer content, it should be layered in only after these shell rules continue to hold.

## Success Checklist

The spike is behaving correctly if:

1. The compact shell appears at the notch, not below it.
2. Hover and click behavior feel bounded and predictable.
3. Expanded state feels like the same object opening.
4. The menu bar extra is visible and usable.
5. `Quit HumanctlNotch` is always available.
6. Relaunching does not leave stale duplicate processes behind.

## Implementation Map

These are the files that matter in the current clean shell-only spike:

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/App/HumanctlNotchApp.swift`
  Menu bar extra, shell toggle action, and quit path.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/App/HumanctlNotchAppDelegate.swift`
  Accessory app lifecycle and runtime startup.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/App/NotchApplicationRuntime.swift`
  Shared runtime object that owns the store, panel controller, and menu bar title.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Shell/NotchShellStateMachine.swift`
  Compact/expanded state transitions and hover-open / hover-close behavior.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Shell/NotchShellStore.swift`
  Store that binds payload availability to shell state and produces snapshots for the UI.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Shell/NotchHostPanelController.swift`
  Nonactivating top-level panel controller, visibility handling, and outside-click dismissal.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Shell/NotchLayoutResolver.swift`
  Compact and expanded frame calculation from the measured notch geometry.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Support/NSScreen+NotchShell.swift`
  Display helpers for notch sizing, center, frame, and stable screen targeting.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Support/NotchShellRootView.swift`
  The actual shell rendering. Right now it should stay visually austere.

- `/Users/danielgwilson/local_git/humanctl/native/macos/HumanctlNotch/Support/NotchShellShape.swift`
  The shell outline shared by compact and expanded states.
