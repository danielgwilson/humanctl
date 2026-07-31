import type { ComponentProps } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { IconButton } from "@humanctl/ui/components/icon-button"
import { cn } from "@humanctl/ui/lib/cn"

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] transition-opacity duration-[var(--duration-overlay-enter)] ease-[var(--ease-enter)] data-ending-style:opacity-0 data-ending-style:duration-[var(--duration-overlay-exit)] data-ending-style:ease-[var(--ease-exit)] data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--radius-4)] bg-overlay p-4 text-ink shadow-[var(--elev-overlay)] outline-none transition-[opacity,transform] duration-[var(--duration-overlay-enter)] ease-[var(--ease-enter)] data-ending-style:translate-y-[calc(-50%+8px)] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-[var(--duration-overlay-exit)] data-ending-style:ease-[var(--ease-exit)] data-starting-style:translate-y-[calc(-50%+8px)] data-starting-style:scale-[0.98] data-starting-style:opacity-0",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            render={
              <IconButton
                aria-label="Close dialog"
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2"
              />
            }
          >
            <XIcon />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-1 pr-8", className)} {...props} />
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 pt-2", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("text-[15px] font-semibold", className)} {...props} />
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("text-sm text-ink-3", className)} {...props} />
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
}
