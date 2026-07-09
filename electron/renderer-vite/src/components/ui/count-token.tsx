import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// New primitive (docs/design-system.md section 6, issue #71 item 1):
// "CountToken | tone: info (transparent, --ink-3, row under [data-numeric],
// followed by a lowercase noun) / alert (--iris-solid fill, --on-solid, full
// radius, 20px). Attention is a fill; information is an alpha. Only the
// sidebar unread badge is alert." Two real call sites this stage: the
// Inbox pane header's thread count (info, replacing a hand-rolled
// count+noun span) and the sidebar's unread badge (alert, replacing a
// `rounded-full bg-iris-solid text-on-solid` className override on
// SidebarMenuBadge -- see nav-sidebar.tsx and sidebar.tsx's own comment on
// that badge, which already named this primitive as its right home).
const countTokenVariants = cva("inline-flex flex-none items-center font-mono", {
  variants: {
    tone: {
      info: "h-5 gap-1 text-ink-3",
      alert: "h-5 min-w-5 justify-center rounded-full bg-iris-solid px-1.5 text-on-solid",
    },
  },
  defaultVariants: { tone: "info" },
})

export function CountToken({
  tone = "info",
  count,
  noun,
  className,
}: VariantProps<typeof countTokenVariants> & { count: number; noun?: string; className?: string }) {
  return (
    <span data-slot="count-token" data-tone={tone} className={cn(countTokenVariants({ tone }), className)}>
      <span className="text-row" data-numeric>{count}</span>
      {tone === "info" && noun && <span className="text-micro">{noun}</span>}
    </span>
  )
}

export { countTokenVariants }
