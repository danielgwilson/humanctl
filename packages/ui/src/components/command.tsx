import type { ComponentProps, ReactNode } from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@humanctl/ui/components/dialog"
import { cn } from "@humanctl/ui/lib/cn"

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex size-full flex-col overflow-hidden bg-overlay text-ink", className)}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Commands",
  description = "Search available actions",
  children,
  ...props
}: ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className="top-[20%] block w-[min(var(--palette),calc(100%-2rem))] max-w-none translate-y-0 overflow-hidden p-0" showCloseButton={false}>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border px-3">
      <SearchIcon className="size-3.5 shrink-0 text-ink-3" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn("h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3", className)}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-80 overflow-y-auto p-1", className)} {...props} />
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className={cn("py-10 text-center text-sm text-ink-3", className)} {...props} />
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "py-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-ink-3",
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-[var(--radius-1)] px-2 text-sm text-ink outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-[var(--overlay-hover)] data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-overlay [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3",
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
}

function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("ml-auto text-xs text-ink-3", className)} {...props} />
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
