import { PanelRightIcon } from "lucide-react"

import { Button } from "@humanctl/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@humanctl/ui/components/dialog"
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@humanctl/ui/components/menu"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@humanctl/ui/components/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@humanctl/ui/components/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@humanctl/ui/components/tooltip"

import type { CatalogEntry } from "../registry"
import { CommandPreview } from "./previews"

export const overlayEntries: CatalogEntry[] = [
  {
    id: "dialog",
    name: "Dialog",
    kind: "component",
    category: "Overlays",
    importPath: "components/dialog",
    exports: ["Dialog", "DialogTrigger", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter"],
    blurb: "A focused modal for a bounded decision that must interrupt. Reserved: most confirmations belong inline.",
    tags: ["modal", "decision"],
    states: [
      {
        name: "Confirm",
        description: "title, description, and a paired action",
        render: () => (
          <Dialog>
            <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Stop this automation?</DialogTitle>
                <DialogDescription>The current run can finish, but no new runs will start.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">Stop automation</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ),
      },
    ],
    accessibility: ["Focus enters the dialog, is trapped, and returns to the trigger on close; Escape dismisses."],
    usage: `<Dialog>
  <DialogTrigger render={<Button />}>Open</DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Stop this automation?</DialogTitle>
      <DialogDescription>No new runs will start.</DialogDescription>
    </DialogHeader>
    <DialogFooter>{/* actions */}</DialogFooter>
  </DialogContent>
</Dialog>`,
  },
  {
    id: "sheet",
    name: "Sheet",
    kind: "component",
    category: "Overlays",
    importPath: "components/sheet",
    exports: ["Sheet", "SheetTrigger", "SheetContent", "SheetHeader", "SheetTitle", "SheetDescription"],
    blurb: "An edge panel for secondary detail. On narrow widths the side rails collapse into a Sheet.",
    tags: ["panel", "responsive"],
    states: [
      {
        name: "Side panel",
        description: "opens from the edge",
        render: () => (
          <Sheet>
            <SheetTrigger render={<Button />}>
              <PanelRightIcon />
              Open panel
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Task detail</SheetTitle>
                <SheetDescription>Viewport state shown without moving runtime ownership into the UI.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        ),
      },
    ],
    accessibility: ["Behaves as a dialog: focus trap, Escape, outside interaction, and focus return."],
    usage: `<Sheet>
  <SheetTrigger render={<Button />}>Open panel</SheetTrigger>
  <SheetContent>
    <SheetHeader><SheetTitle>Task detail</SheetTitle></SheetHeader>
  </SheetContent>
</Sheet>`,
  },
  {
    id: "popover",
    name: "Popover",
    kind: "component",
    category: "Overlays",
    importPath: "components/popover",
    exports: ["Popover", "PopoverTrigger", "PopoverContent", "PopoverHeader", "PopoverTitle", "PopoverDescription"],
    blurb: "A small anchored surface for a why-this or a quick control, dismissed on outside interaction.",
    tags: ["anchored", "disclosure"],
    states: [
      {
        name: "Why this status",
        description: "titled explanation",
        render: () => (
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" />}>Why this status?</PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Needs input</PopoverTitle>
                <PopoverDescription>The worker asked a bounded question 18 minutes ago.</PopoverDescription>
              </PopoverHeader>
              Open the task to answer it.
            </PopoverContent>
          </Popover>
        ),
      },
    ],
    accessibility: ["Opens on the trigger, returns focus on close, and dismisses on Escape or outside click."],
    usage: `<Popover>
  <PopoverTrigger render={<Button variant="ghost" />}>Why this status?</PopoverTrigger>
  <PopoverContent>
    <PopoverHeader><PopoverTitle>Needs input</PopoverTitle></PopoverHeader>
  </PopoverContent>
</Popover>`,
  },
  {
    id: "menu",
    name: "Menu",
    kind: "component",
    category: "Overlays",
    importPath: "components/menu",
    exports: ["Menu", "MenuTrigger", "MenuContent", "MenuGroup", "MenuItem", "MenuLabel", "MenuSeparator", "MenuShortcut"],
    blurb: "A command menu of actions on an object, with groups, labels, separators, and shortcut hints.",
    tags: ["actions", "menu"],
    states: [
      {
        name: "Grouped actions",
        description: "label, items, separator",
        render: () => (
          <Menu>
            <MenuTrigger render={<Button />}>Actions</MenuTrigger>
            <MenuContent>
              <MenuLabel>Session</MenuLabel>
              <MenuGroup>
                <MenuItem>
                  Open workspace <MenuShortcut>↵</MenuShortcut>
                </MenuItem>
                <MenuItem>Copy task ID</MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuGroup>
                <MenuItem>Archive</MenuItem>
              </MenuGroup>
            </MenuContent>
          </Menu>
        ),
      },
    ],
    accessibility: ["Arrow keys move between items; Escape closes; the trigger regains focus."],
    usage: `<Menu>
  <MenuTrigger render={<Button />}>Actions</MenuTrigger>
  <MenuContent>
    <MenuLabel>Session</MenuLabel>
    <MenuGroup><MenuItem>Open workspace</MenuItem></MenuGroup>
  </MenuContent>
</Menu>`,
  },
  {
    id: "tooltip",
    name: "Tooltip",
    kind: "component",
    category: "Overlays",
    importPath: "components/tooltip",
    exports: ["Tooltip", "TooltipTrigger", "TooltipContent", "TooltipProvider"],
    blurb: "A hover and focus hint for an icon-only control. Never the only place a critical label lives.",
    tags: ["hint", "hover"],
    states: [
      {
        name: "On a control",
        description: "hover or focus the button",
        render: () => (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" />}>Hover me</TooltipTrigger>
            <TooltipContent>Runs the browser proof</TooltipContent>
          </Tooltip>
        ),
      },
    ],
    accessibility: [
      "Wrap the app once in TooltipProvider.",
      "Appears on focus as well as hover; never hides a label a keyboard user needs.",
    ],
    usage: `<TooltipProvider>
  <Tooltip>
    <TooltipTrigger render={<IconButton aria-label="Notifications" />}>
      <BellIcon />
    </TooltipTrigger>
    <TooltipContent>Notifications</TooltipContent>
  </Tooltip>
</TooltipProvider>`,
  },
  {
    id: "command",
    name: "Command",
    kind: "component",
    category: "Overlays",
    importPath: "components/command",
    exports: ["Command", "CommandDialog", "CommandInput", "CommandList", "CommandGroup", "CommandItem", "CommandEmpty", "CommandShortcut"],
    blurb: "The command palette: a fuzzy-searchable action list in a dialog, grouped with shortcut hints.",
    tags: ["palette", "search"],
    states: [
      {
        name: "Open the palette",
        description: "searchable grouped actions",
        render: () => <CommandPreview />,
      },
    ],
    accessibility: [
      "Type to filter, arrow to move, Enter to run, Escape to close.",
      "The empty state names that nothing matched rather than showing a blank list.",
    ],
    usage: `<CommandDialog open={open} onOpenChange={setOpen}>
  <Command>
    <CommandInput placeholder="Search actions" />
    <CommandList>
      <CommandEmpty>No actions found.</CommandEmpty>
      <CommandGroup heading="Navigation">{/* CommandItem */}</CommandGroup>
    </CommandList>
  </Command>
</CommandDialog>`,
  },
]
