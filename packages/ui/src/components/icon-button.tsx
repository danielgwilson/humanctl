import type { ReactNode } from "react"

import { Button, type ButtonProps } from "@humanctl/ui/components/button"
import { cn } from "@humanctl/ui/lib/cn"

type IconButtonProps = Omit<ButtonProps, "aria-label" | "children" | "size"> & {
  "aria-label": string
  children?: ReactNode
  size?: "sm" | "default"
}

function IconButton({
  className,
  size = "default",
  ...props
}: IconButtonProps) {
  return (
    <Button
      data-slot="icon-button"
      size={size === "sm" ? "icon-sm" : "icon"}
      className={cn("shrink-0", className)}
      {...props}
    />
  )
}

export { IconButton, type IconButtonProps }
