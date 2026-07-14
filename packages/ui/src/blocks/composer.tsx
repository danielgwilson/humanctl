import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { ArrowUpIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@humanctl/ui/components/button"
import { Textarea } from "@humanctl/ui/components/textarea"
import { cn } from "@humanctl/ui/lib/cn"

type ComposerProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  submitting?: boolean
  hint?: ReactNode
  actions?: ReactNode
  submitLabel?: string
  className?: string
}

function Composer({
  value,
  onValueChange,
  onSubmit,
  placeholder = "Write a reply",
  disabled = false,
  submitting = false,
  hint = "Command or Control + Enter to send",
  actions,
  submitLabel = "Send",
  className,
}: ComposerProps) {
  const canSubmit = value.trim().length > 0 && !disabled && !submitting

  const submit = () => {
    if (canSubmit) onSubmit()
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      data-slot="composer"
      className={cn("rounded-[var(--radius-4)] bg-sunken p-1.5 shadow-[var(--elev-ring)] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background", className)}
      onSubmit={handleSubmit}
    >
      <Textarea
        aria-label={placeholder}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-20 max-h-48 bg-transparent px-2 py-1.5 shadow-none focus-visible:shadow-none"
      />
      <div className="flex min-h-[var(--control-sm)] items-center gap-1 px-1">
        {actions}
        {hint ? <span className="ml-1 truncate font-mono text-[11px] text-ink-3 max-[560px]:hidden">{hint}</span> : null}
        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} className="ml-auto">
          {submitting ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <ArrowUpIcon />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export { Composer, type ComposerProps }
