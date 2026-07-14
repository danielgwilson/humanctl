import type { ComponentProps } from "react"

import { cn } from "@humanctl/ui/lib/cn"

function PageFrame({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="page-frame"
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-background", className)}
      {...props}
    />
  )
}

function PageHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex min-h-[var(--row-decision)] shrink-0 items-center gap-4 border-b border-border px-4 py-2", className)}
      {...props}
    />
  )
}

function PageHeading({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />
}

function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("truncate text-[16px] leading-5 font-semibold text-ink", className)} {...props} />
}

function PageDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-0.5 truncate text-[13px] leading-5 text-ink-3", className)} {...props} />
}

function PageActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ml-auto flex shrink-0 items-center gap-1.5", className)} {...props} />
}

function PageBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-hidden", className)} {...props} />
}

export { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle }
