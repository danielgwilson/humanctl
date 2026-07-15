import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@humanctl/ui/lib/cn"

function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-[var(--control)] w-full min-w-0 rounded-[var(--radius-3)] bg-sunken px-2.5 font-sans text-sm text-ink shadow-[var(--elev-ring)] outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 aria-invalid:shadow-[inset_0_0_0_1px_var(--block-contrast)]",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
