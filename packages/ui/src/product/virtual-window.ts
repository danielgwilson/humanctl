export type VirtualWindowInput = {
  count: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  overscan: number
}

export type VirtualWindow = {
  start: number
  end: number
  offset: number
  total: number
}

export const DEFAULT_VIRTUAL_ROW_HEIGHT = 52

export type FixedRowGeometry = {
  lineHeights: ReadonlyArray<number>
  gaps: ReadonlyArray<number>
  verticalPadding: number
  border: number
}

export function fixedRowMinimumHeight({
  lineHeights,
  gaps,
  verticalPadding,
  border,
}: FixedRowGeometry): number {
  return [...lineHeights, ...gaps, verticalPadding, border]
    .reduce((total, value) => total + Math.max(0, value), 0)
}

export function getVirtualWindow({
  count,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}: VirtualWindowInput): VirtualWindow {
  const safeCount = Math.max(0, Math.floor(count))
  const safeHeight = Math.max(1, rowHeight)
  const safeOverscan = Math.max(0, Math.floor(overscan))
  const unclampedFirst = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeHeight))
  const firstVisible = safeCount === 0 ? 0 : Math.min(safeCount - 1, unclampedFirst)
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / safeHeight))
  const start = Math.max(0, Math.min(safeCount, firstVisible - safeOverscan))
  const end = Math.max(start, Math.min(safeCount, firstVisible + visibleCount + safeOverscan))

  return {
    start,
    end,
    offset: start * safeHeight,
    total: safeCount * safeHeight,
  }
}
