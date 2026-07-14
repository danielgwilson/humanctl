import { DEFAULT_VIRTUAL_ROW_HEIGHT, fixedRowMinimumHeight, getVirtualWindow } from "./virtual-window"

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`)
}

function truthy(value: unknown, label: string) {
  if (!value) throw new Error(`${label}: expected a truthy value`)
}

const authoredListRowMinimum = fixedRowMinimumHeight({
  lineHeights: [20, 20, 16],
  gaps: [2, 2],
  verticalPadding: 16,
  border: 1,
})
equal(authoredListRowMinimum, 77, "authored three-line row minimum is explicit")
truthy(DEFAULT_VIRTUAL_ROW_HEIGHT >= authoredListRowMinimum, "virtual allocation contains the authored row")

const first = getVirtualWindow({ count: 240, scrollTop: 0, viewportHeight: 800, rowHeight: DEFAULT_VIRTUAL_ROW_HEIGHT, overscan: 6 })
equal(first.start, 0, "first window starts at zero")
equal(first.end, 16, "first window is bounded")
equal(first.total, 19_200, "spacer represents every row")

const middle = getVirtualWindow({ count: 240, scrollTop: 8_000, viewportHeight: 800, rowHeight: DEFAULT_VIRTUAL_ROW_HEIGHT, overscan: 6 })
equal(middle.start, 94, "middle window includes leading overscan")
equal(middle.end, 116, "middle window includes trailing overscan")
equal(middle.offset, 7_520, "middle window offset is stable")

const end = getVirtualWindow({ count: 240, scrollTop: 99_999, viewportHeight: 800, rowHeight: DEFAULT_VIRTUAL_ROW_HEIGHT, overscan: 6 })
equal(end.start, 233, "out-of-range scroll keeps a bounded tail window")
equal(end.end, 240, "out-of-range scroll never blanks a nonempty list")
equal(end.offset, 18_640, "tail window offset follows the clamped first row")

console.log("virtual-list.selftest: ok")
