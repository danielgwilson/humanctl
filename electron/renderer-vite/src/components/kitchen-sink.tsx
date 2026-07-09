import { useEffect, useState } from 'react';
import { Bell, Search, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Icon } from '@/components/ui/icon';
import { Chip } from '@/components/ui/chip';
import { Dot, type Hue } from '@/components/ui/dot';
import { Kbd } from '@/components/ui/kbd';
import { CountToken } from '@/components/ui/count-token';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Item, ItemContent, ItemGroup, ItemHeader, ItemSeparator, ItemTitle, ItemDescription } from '@/components/ui/item';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

const HUES: Hue[] = ['iris', 'work', 'need', 'block', 'done', 'idle', 'series-1', 'series-2'];
const BUTTON_VARIANTS = ['primary', 'default', 'quiet', 'danger', 'danger-quiet'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
const ICON_BUTTON_SIZES = ['sm', 'md', 'lg'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-b-hairline px-6 py-6">
      <h2 className="mb-4 font-sans text-title text-ink">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-32 flex-none font-mono text-micro text-ink-4">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// /kitchen-sink: a fixture-only route showing every primitive in every
// variant and state (issue #71's own verification demand: "It is the only
// way to review 40 variants and it pays for itself the first time it catches
// a regression"). Driven the same renderer-only way as the existing views
// (App.tsx's window.__humanctlPerf test hook), never a registered command,
// never reachable from the nav rail, the command palette, or a keyboard
// shortcut -- see App.tsx's own comment on setKitchenSink.
export function KitchenSink() {
  const [toggled, setToggled] = useState(false);
  const [toggleGroupValue, setToggleGroupValue] = useState('b');

  // Fires once on mount so Sonner's Toaster (mounted once in App.tsx) has
  // something to show in the capture -- the one primitive with no other way
  // to force itself open for a static screenshot. Dismissed on unmount
  // (toast.dismiss() with no id clears every open toast): Toaster is
  // mounted once at the App root, outside this route's own lifecycle, so a
  // toast fired here would otherwise keep rendering for its own ~4s
  // duration after leaving /kitchen-sink -- exactly what leaked into the
  // very next screenshot (inbox-light) the first time this route existed.
  useEffect(() => {
    const t = setTimeout(() => toast('kitchen-sink: a toast, on mount'), 300);
    return () => {
      clearTimeout(t);
      toast.dismiss();
    };
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        <div className="border-b border-b-hairline px-6 py-4">
          <h1 className="font-sans text-title text-ink">Kitchen sink</h1>
          <p className="font-mono text-micro text-ink-4">
            fixture-only, every primitive in every variant -- docs/design-system.md section 6
          </p>
        </div>

        <Section title="Button">
          {BUTTON_VARIANTS.map((variant) => (
            <Row key={variant} label={variant}>
              {BUTTON_SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size}
                </Button>
              ))}
              <Button variant={variant} disabled>
                disabled
              </Button>
            </Row>
          ))}
        </Section>

        <Section title="IconButton">
          <Row label="rest">
            {ICON_BUTTON_SIZES.map((size) => (
              <IconButton key={size} icon={Bell} size={size} aria-label={`icon button ${size}`} />
            ))}
          </Row>
          <Row label="active">
            {ICON_BUTTON_SIZES.map((size) => (
              <IconButton key={size} icon={Bell} size={size} active aria-label={`icon button ${size} active`} />
            ))}
          </Row>
        </Section>

        <Section title="Chip">
          <Row label="state">
            {HUES.map((hue) => (
              <Chip key={hue} variant="state" hue={hue}>
                {hue}
              </Chip>
            ))}
          </Row>
          <Row label="meta">
            <Chip variant="meta">a plain label</Chip>
            <Chip variant="meta">AI summary</Chip>
          </Row>
        </Section>

        <Section title="Dot">
          <Row label="hues">
            {HUES.map((hue) => (
              <span key={hue} className="inline-flex items-center gap-1.5 font-mono text-micro text-ink-3">
                <Dot hue={hue} />
                {hue}
              </span>
            ))}
          </Row>
        </Section>

        <Section title="Kbd">
          <Row label="keys">
            <Kbd>1</Kbd>
            <Kbd>A</Kbd>
            <Kbd>esc</Kbd>
            <Kbd>&#8984;\</Kbd>
          </Row>
        </Section>

        <Section title="CountToken">
          <Row label="info">
            <CountToken tone="info" count={12} noun="threads" />
          </Row>
          <Row label="alert">
            <CountToken tone="alert" count={3} />
          </Row>
        </Section>

        <Section title="Input / Textarea / Select">
          <Row label="input md">
            <Input placeholder="md (28px)" />
          </Row>
          <Row label="input lg">
            <Input size="lg" placeholder="lg (32px)" />
          </Row>
          <Row label="input states">
            <Input placeholder="disabled" disabled />
            <Input placeholder="invalid" aria-invalid />
          </Row>
          <Row label="textarea">
            <Textarea placeholder="a textarea, r12" className="w-64" />
          </Row>
          <Row label="select">
            <Select defaultValue="b">
              <SelectTrigger aria-label="kitchen-sink select" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">option a</SelectItem>
                <SelectItem value="b">option b</SelectItem>
                <SelectItem value="c">option c</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        <Section title="Toggle / ToggleGroup">
          <Row label="toggle">
            <Toggle pressed={toggled} onPressedChange={setToggled} aria-label="toggle">
              toggle
            </Toggle>
          </Row>
          <Row label="toggle group">
            <ToggleGroup type="single" value={toggleGroupValue} onValueChange={(v) => v && setToggleGroupValue(v)} aria-label="toggle group">
              <ToggleGroupItem value="a">A</ToggleGroupItem>
              <ToggleGroupItem value="b">B</ToggleGroupItem>
              <ToggleGroupItem value="c">C</ToggleGroupItem>
            </ToggleGroup>
          </Row>
        </Section>

        <Section title="Item">
          <ItemGroup className="hairline max-w-md rounded-4 p-1">
            <Item size="default">
              <ItemContent>
                <ItemTitle>default size item</ItemTitle>
                <ItemDescription>with a description line beneath it.</ItemDescription>
              </ItemContent>
            </Item>
            <ItemSeparator />
            <Item size="sm">
              <ItemHeader>
                <Chip variant="meta">sm size</Chip>
              </ItemHeader>
            </Item>
          </ItemGroup>
        </Section>

        <Section title="Empty">
          <Row label="slot">
            <div className="hairline h-32 w-64 rounded-4">
              <Empty>
                <EmptyDescription>a slot-grade empty state.</EmptyDescription>
              </Empty>
            </div>
          </Row>
          <Row label="view">
            <div className="hairline h-40 w-96 rounded-4">
              <Empty>
                <EmptyTitle size="view">nothing here yet</EmptyTitle>
                <EmptyDescription size="view">
                  A view-grade empty state caps its description at a hard ~40 character measure.
                </EmptyDescription>
              </Empty>
            </div>
          </Row>
        </Section>

        <Section title="Progress">
          <Row label="hues">
            <Progress value={70} indicator="iris" className="w-40" />
            <Progress value={40} indicator="need" className="w-40" />
            <Progress value={90} indicator="block" className="w-40" />
            <Progress value={55} indicator="work" className="w-40" />
            <Progress value={25} indicator="ink3" className="w-40" />
          </Row>
        </Section>

        <Section title="Separator">
          <Row label="full-bleed">
            <div className="w-64">
              <Separator />
            </div>
          </Row>
          <Row label="inset">
            <div className="hairline w-64 rounded-4 px-4 py-2">
              <Separator inset />
            </div>
          </Row>
        </Section>

        <Section title="ScrollArea">
          <Row label="scroll">
            <ScrollArea className="hairline h-24 w-48 rounded-4">
              <div className="flex flex-col gap-2 p-2">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="font-mono text-micro text-ink-3">row {i + 1}</div>
                ))}
              </div>
            </ScrollArea>
          </Row>
        </Section>

        <Section title="Tooltip">
          <Row label="open">
            <Tooltip open>
              <TooltipTrigger asChild>
                <IconButton icon={Search} aria-label="search" />
              </TooltipTrigger>
              <TooltipContent side="right">a tooltip, forced open</TooltipContent>
            </Tooltip>
          </Row>
        </Section>

        <Section title="DropdownMenu">
          {/* min-h-52 reserves room for the forced-open menu below the
              trigger so it does not overlap the ContextMenu section's own
              trigger box beneath it. */}
          <div className="min-h-52">
            <Row label="open">
              <DropdownMenu open>
                <DropdownMenuTrigger asChild>
                  <Button variant="default">menu trigger</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Section</DropdownMenuLabel>
                  <DropdownMenuItem>Item one</DropdownMenuItem>
                  <DropdownMenuItem>Item two</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value="a">
                    <DropdownMenuRadioItem value="a">Radio a</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="b">Radio b</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Row>
          </div>
        </Section>

        <Section title="ContextMenu">
          <Row label="right-click">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="hairline flex h-16 w-48 items-center justify-center rounded-4 font-mono text-micro text-ink-3">
                  right-click me
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Context item one</ContextMenuItem>
                <ContextMenuItem>Context item two</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </Row>
        </Section>

        <Section title="Command">
          <Row label="inline">
            <Command className="hairline w-72">
              <CommandList>
                <CommandGroup heading="Go to">
                  <CommandItem>
                    <span className="flex-1">Inbox</span>
                    <CommandShortcut><Kbd>1</Kbd></CommandShortcut>
                  </CommandItem>
                  <CommandItem>
                    <span className="flex-1">Metrics</span>
                    <CommandShortcut><Kbd>2</Kbd></CommandShortcut>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  <CommandItem>
                    <span className="flex-1">Mark all read</span>
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Row>
        </Section>

        <Section title="Dialog">
          <Row label="open">
            <span className="font-mono text-micro text-ink-4">
              forced open, portalled and fixed-centred over the page (no scrim by design -- everything behind stays legible)
            </span>
          </Row>
        </Section>
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>A dialog, forced open</DialogTitle>
              <DialogDescription>No scrim: the page behind stays at full contrast.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="default">Close</Button>
              <Button variant="primary">Confirm</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Section title="Sheet">
          <Row label="open">
            <span className="font-mono text-micro text-ink-4">forced open, docked to the right edge, same no-scrim rule</span>
          </Row>
        </Section>
        <Sheet open>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>A sheet, forced open</SheetTitle>
              <SheetDescription>Same no-scrim rule as Dialog.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>

        <div className="px-6 py-6 font-mono text-micro text-ink-4">
          <Icon icon={Settings2} className="mb-2" aria-hidden="true" />
          end of kitchen sink.
        </div>
      </div>
    </ScrollArea>
  );
}
