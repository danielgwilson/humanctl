import { useState } from "react"
import { CircleEllipsisIcon, CommandIcon, InboxIcon, LayersIcon, MoreHorizontalIcon, SearchIcon, SettingsIcon } from "lucide-react"

import { Composer } from "@humanctl/ui/blocks/composer"
import { DetailPane } from "@humanctl/ui/blocks/detail-pane"
import { Button } from "@humanctl/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@humanctl/ui/components/command"
import { IconButton } from "@humanctl/ui/components/icon-button"

// Stateful preview components for catalog entries live here so the entry data
// modules export only their entry arrays (react-refresh/only-export-components).

export function ComposerPreview() {
  const [value, setValue] = useState("")
  const [sent, setSent] = useState(0)
  return (
    <div className="w-full max-w-md">
      <Composer
        value={value}
        onValueChange={setValue}
        onSubmit={() => {
          setSent((count) => count + 1)
          setValue("")
        }}
        hint={sent > 0 ? `${sent} local send${sent === 1 ? "" : "s"}` : undefined}
      />
    </div>
  )
}

export function CommandPreview() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CommandIcon />
        Command palette
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search actions" />
          <CommandList>
            <CommandEmpty>No actions found.</CommandEmpty>
            <CommandGroup heading="Navigation">
              <CommandItem>
                <SearchIcon />
                Open sessions
                <CommandShortcut>⌘1</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <CircleEllipsisIcon />
                Open automations
                <CommandShortcut>⌘2</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <SettingsIcon />
                Open settings
                <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

// AppShell owns 100dvh chrome with a fixed-position rail gap, so it cannot mount
// live inside a bounded doc stage without escaping the viewport. This is a
// representative composition of its slots; the live rail is on the Sidebar page,
// and the live scrolling detail surface is on the DetailPane page.
export function AppShellPreview() {
  const railItems = [
    { icon: InboxIcon, label: "Inbox", active: true },
    { icon: LayersIcon, label: "Sessions", active: false },
    { icon: SettingsIcon, label: "Settings", active: false },
  ]
  return (
    <div className="grid h-72 w-full max-w-2xl grid-cols-[168px_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-border bg-background">
      <div className="flex flex-col gap-1 border-r border-border bg-sunken p-2">
        <div className="px-2 py-1.5 font-mono text-[11px] text-ink-3">humanctl</div>
        {railItems.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.label}
              className={
                "flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] " +
                (item.active ? "bg-accent-soft text-ink" : "text-ink-2")
              }
            >
              <Icon className="size-4" />
              {item.label}
            </div>
          )
        })}
      </div>
      <div className="grid grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className="flex h-12 items-center border-b border-border px-4 text-[13px] font-medium text-ink">Inbox</div>
        <div className="p-4 text-[13px] leading-5 text-ink-2">
          The active view renders here, beside the rail and inside the top and bottom chrome. Optional detail and assistant rails dock on the right.
        </div>
        <div className="flex h-8 items-center border-t border-border px-4 font-mono text-[11px] text-ink-4">6 sessions · 2 need you</div>
      </div>
    </div>
  )
}

export function DetailPanePreview() {
  const [value, setValue] = useState("")
  return (
    <div className="h-96 w-full max-w-xl overflow-hidden rounded-[10px] border border-border">
      <DetailPane
        title="Desktop viewport reset"
        eyebrow="Task 019f"
        meta="Updated just now"
        actions={
          <IconButton aria-label="Task options" variant="ghost" size="sm">
            <MoreHorizontalIcon />
          </IconButton>
        }
        footer={<Composer value={value} onValueChange={setValue} onSubmit={() => setValue("")} />}
      >
        <div className="flex flex-col gap-4 text-[13px] leading-5 text-ink-2">
          <p>The shell rendered immediately. Sessions, quota, and activity filled independently.</p>
          <p>Only the runtime adapter reads the desktop bridge. This surface receives serializable state and emits intents.</p>
          <div className="border-y border-border py-3 text-[12px] font-medium text-ink-3">Offline 18m · reramp required</div>
          <p>The worker should re-read current files and process state before continuing.</p>
        </div>
      </DetailPane>
    </div>
  )
}
