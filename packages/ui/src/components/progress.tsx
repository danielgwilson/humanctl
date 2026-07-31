import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@humanctl/ui/lib/cn"

function Progress({
  className,
  children,
  value,
  showTrack = true,
  ...props
}: ProgressPrimitive.Root.Props & { showTrack?: boolean }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1.5", className)}
      {...props}
    >
      {children}
      {showTrack ? (
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      ) : null}
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full rounded-full bg-primary transition-[width] duration-[var(--duration-overlay-enter)] ease-[var(--ease-shape)]",
        className,
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      data-slot="progress-label"
      className={cn("text-sm text-ink-2", className)}
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      data-slot="progress-value"
      className={cn("ml-auto text-xs tabular-nums text-ink-3", className)}
      {...props}
    />
  )
}

export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
}
