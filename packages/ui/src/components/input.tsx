import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@humanctl/ui/lib/cn"

function Input({ className, ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-[var(--control)] w-full min-w-0 rounded-[var(--radius-2)] bg-sunken px-2.5 font-sans text-sm text-ink shadow-[var(--elev-ring)] outline-none placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-ink)] aria-invalid:shadow-[inset_0_0_0_1px_var(--block-contrast)]",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
