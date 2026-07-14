import type { ComponentProps } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@humanctl/ui/lib/cn"

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-72 origin-[var(--transform-origin)] rounded-[var(--radius-3)] bg-overlay p-3 text-[13px] text-ink shadow-[var(--elev-overlay)] outline-none transition-[opacity,transform] duration-[var(--duration-overlay-enter)] ease-[var(--ease-enter)] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-[var(--duration-overlay-exit)] data-ending-style:ease-[var(--ease-exit)] data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-2 space-y-0.5", className)} {...props} />
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title className={cn("font-medium text-ink", className)} {...props} />
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description className={cn("text-ink-3", className)} {...props} />
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
