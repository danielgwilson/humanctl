import type { ComponentProps } from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { IconButton } from "@humanctl/ui/components/icon-button"
import { cn } from "@humanctl/ui/lib/cn"

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] transition-opacity duration-[var(--duration-overlay-enter)] ease-[var(--ease-enter)] data-ending-style:opacity-0 data-ending-style:duration-[var(--duration-overlay-exit)] data-ending-style:ease-[var(--ease-exit)] data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-overlay text-ink shadow-[var(--elev-overlay)] outline-none transition-[opacity,transform] duration-[var(--duration-overlay-enter)] ease-[var(--ease-enter)] data-ending-style:opacity-0 data-ending-style:duration-[var(--duration-overlay-exit)] data-ending-style:ease-[var(--ease-exit)] data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[85vh] data-[side=bottom]:rounded-t-[var(--radius-4)] data-[side=bottom]:data-ending-style:translate-y-6 data-[side=bottom]:data-starting-style:translate-y-6 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:w-[min(var(--detail),90vw)] data-[side=left]:data-ending-style:-translate-x-6 data-[side=left]:data-starting-style:-translate-x-6 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:w-[min(var(--detail),90vw)] data-[side=right]:data-ending-style:translate-x-6 data-[side=right]:data-starting-style:translate-x-6 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:max-h-[85vh] data-[side=top]:rounded-b-[var(--radius-4)] data-[side=top]:data-ending-style:-translate-y-6 data-[side=top]:data-starting-style:-translate-y-6",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            render={
              <IconButton
                aria-label="Close panel"
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
              />
            }
          >
            <XIcon />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-1 border-b border-border p-4 pr-12", className)} {...props} />
}

function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-hidden p-4", className)} {...props} />
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border p-4", className)} {...props} />
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return <SheetPrimitive.Title className={cn("text-[15px] font-semibold", className)} {...props} />
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return <SheetPrimitive.Description className={cn("text-[13px] text-ink-3", className)} {...props} />
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
