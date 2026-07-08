import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Restyled onto the humanctl tokens (DESIGN.md: Space Grotesk display,
// JetBrains Mono labels, iris accent, flat panel surfaces) rather than left
// as the stock shadcn zinc/new-york look. `bg-popover`/`bg-accent` already
// resolve to `--panel2` via the CSS-var bridge in globals.css, but stock
// shadcn's `data-[selected=true]:bg-accent` is a no-op here because
// `--accent` and `--popover` are the SAME value (both `--panel2`) -- the
// selected/hovered row needs an explicit iris tint (see CommandItem below),
// matching the active-state language already used by the nav sidebar
// (`!bg-iris/16`) and the theme picker (`bg-iris text-primary-foreground`).
function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground",
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
          "top-[16%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-2xl",
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
      className="flex h-12 flex-none items-center gap-2.5 border-b border-border px-4"
    >
      <SearchIcon className="size-[15px] flex-none text-ink4" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-full w-full rounded-md bg-transparent text-[13.5px] text-foreground outline-hidden placeholder:text-ink4 disabled:cursor-not-allowed disabled:opacity-50",
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
      className={cn("py-10 text-center text-[12.5px] text-ink3", className)}
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
        "overflow-hidden px-1.5 text-foreground [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink4",
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
      className={cn("mx-1.5 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

// The selected/highlighted row: iris tint (bg-iris/14, matching the nav
// sidebar's `!bg-iris/16` active treatment) rather than stock shadcn's
// `data-[selected=true]:bg-accent`, which would be an invisible no-op here
// (`--accent` === `--popover`, see the file header comment).
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-iris/14 data-[selected=true]:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-ink3",
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
        "ml-auto flex-none font-mono text-[10px] uppercase tracking-wider text-ink4",
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
