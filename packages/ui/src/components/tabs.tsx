import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@humanctl/ui/lib/cn"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex h-[var(--control)] w-fit items-stretch gap-4 border-b border-border", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative flex items-center gap-1.5 rounded-[var(--radius-1)] px-0.5 font-sans text-sm text-ink-3 outline-none transition-colors duration-[var(--duration-color)] hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] data-active:font-medium data-active:text-ink after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 data-active:after:opacity-100",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
