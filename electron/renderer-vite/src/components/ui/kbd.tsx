import * as React from "react"

import { cn } from "@/lib/utils"

// New primitive (docs/design-system.md section 6, issue #71 item 1): "Kbd |
// A 20px box, radius 6, hairline ring, micro, --ink-3. Renders on a surface
// only, never inside a solid fill." A real `<kbd>` element (semantic
// keyboard-input markup), styled as a single-glyph key cap. `min-w-5` keeps
// a one-character key ("A", "1") square-ish while letting a wider label
// ("esc", "tab") grow past it -- `px-1` supplies the same breathing room
// Chip's own 20px box uses.
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-1 hairline px-1 font-mono text-micro text-ink-3",
        className
      )}
      {...props}
    />
  )
}
