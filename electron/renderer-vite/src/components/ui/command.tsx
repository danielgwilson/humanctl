import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Icon } from "@/components/ui/icon"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Restyled onto the humanctl tokens (docs/design-system.md: mono is the
// chrome, iris is the identity, flat floating surfaces) rather than left as
// the stock shadcn zinc/new-york look. The palette is a floating surface
// (section 6: "Command palette | ... overlay elevation, no scrim"), so it
// paints `--surface-2` + the `overlay` elevation utility, not the retired
// `--popover` bridge.
function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface-2 font-mono text-row text-ink",
        className
      )}
      {...props}
    />
  )
}

// Top-anchored, not dead-centered (a palette is a launcher, not a stock
// centered shadcn dialog) -- overrides DialogContent's default
// `top-[50%] ... translate-y-[-50%]` via twMerge so the palette sits in the
// upper third of the window, closer to where the eye already lands after
// Cmd+K.
function CommandDialog({
  title = "Command palette",
  description = "Jump to a view, session, or action.",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-[16%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-lg overlay bg-surface-2 p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group]:not(:first-child)_[cmdk-group-heading]]:pt-1.5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-12 flex-none items-center gap-2.5 border-b border-hairline px-4"
    >
      <Icon icon={SearchIcon} className="flex-none text-ink-4" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-full w-full rounded-md bg-transparent font-mono text-row text-ink outline-hidden placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[420px] scroll-py-1 overflow-x-hidden overflow-y-auto py-1.5",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-10 text-center font-mono text-micro text-ink-3", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden px-1.5 font-mono text-row text-ink [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-ink-4",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("mx-1.5 my-1 h-px bg-hairline", className)}
      {...props}
    />
  )
}

// The selected/highlighted row: `--overlay-selected` (stage 2, #68, one of
// the five selection dialects unified onto this one token), replacing a
// hardcoded `bg-iris/14` one-off that predated the token.
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 font-mono text-row text-ink outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-selected data-[selected=true]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-ink-3",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto flex-none font-mono text-micro text-ink-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
