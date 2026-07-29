import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { ArrowUpIcon } from "lucide-react"

import { Button } from "@humanctl/ui/components/button"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@humanctl/ui/components/input-group"
import { Spinner } from "@humanctl/ui/components/spinner"
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
      className={cn("w-full", className)}
      onSubmit={handleSubmit}
    >
      <InputGroup className="overflow-hidden">
        <InputGroupTextarea
          aria-label={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-20 max-h-48 px-2.5 pt-2 pb-1"
        />
        <InputGroupAddon align="block-end" className="min-h-[var(--control-sm)] justify-start gap-1 px-2 pt-1 pb-1.5">
          {actions}
          {hint ? <span className="ml-1 truncate text-xs text-ink-3 max-[560px]:hidden">{hint}</span> : null}
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit} className="ml-auto">
            {submitting ? <Spinner data-icon="inline-start" /> : <ArrowUpIcon data-icon="inline-start" />}
            {submitLabel}
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

export { Composer, type ComposerProps }
