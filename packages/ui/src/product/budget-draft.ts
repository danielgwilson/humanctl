export type BudgetDraft = {
  value: string
  dirty: boolean
}

export type BudgetCommitDecision =
  | { kind: "discard"; displayValue: string }
  | { kind: "commit"; value: number; displayValue: string }

export function formatBudgetInput(value: number): string {
  return String(value)
}

export function budgetInputValue(draft: BudgetDraft | null, externalBudget: number): string {
  return draft?.dirty ? draft.value : formatBudgetInput(externalBudget)
}

export function decideBudgetCommit(
  draft: BudgetDraft | null,
  externalBudget: number,
  fallbackBudget: number,
): BudgetCommitDecision {
  if (!draft?.dirty) return { kind: "discard", displayValue: formatBudgetInput(externalBudget) }
  const parsed = Number(draft.value)
  const value = Math.max(0.1, Number.isFinite(parsed) && parsed !== 0 ? parsed : fallbackBudget)
  return { kind: "commit", value, displayValue: formatBudgetInput(value) }
}
