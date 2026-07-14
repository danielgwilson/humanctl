import { budgetInputValue, decideBudgetCommit } from "./budget-draft"

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`)
}

const staleClean = decideBudgetCommit({ value: "1", dirty: false }, 2.5, 1)
equal(staleClean.kind, "discard", "clean focused value does not overwrite newer external state")
equal(staleClean.displayValue, "2.5", "clean focused value resynchronizes after edit ends")
equal(budgetInputValue({ value: "1", dirty: false }, 2.5), "2.5", "clean focused value shows newer external state immediately")

const activeEdit = decideBudgetCommit({ value: "3.75", dirty: true }, 2.5, 1)
equal(activeEdit.kind, "commit", "active edit remains authoritative")
equal(budgetInputValue({ value: "3.75", dirty: true }, 2.5), "3.75", "dirty draft stays visible across external updates")
if (activeEdit.kind === "commit") equal(activeEdit.value, 3.75, "active edit commits its draft")

const invalid = decideBudgetCommit({ value: "", dirty: true }, 2.5, 1)
if (invalid.kind === "commit") equal(invalid.value, 1, "empty dirty draft uses the safe fallback")

const belowMinimum = decideBudgetCommit({ value: "-4", dirty: true }, 2.5, 1)
if (belowMinimum.kind === "commit") equal(belowMinimum.value, 0.1, "dirty draft respects the minimum")

console.log("budget-draft.selftest: ok")
