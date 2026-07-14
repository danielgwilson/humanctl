import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type KeyboardEventHandler,
} from "react"

import { ScrollArea } from "@humanctl/ui/components/scroll-area"

import { DEFAULT_VIRTUAL_ROW_HEIGHT, getVirtualWindow } from "./virtual-window"

const DEFAULT_OVERSCAN = 6
const DEFAULT_THRESHOLD = 200

export type VirtualRowProps = {
  "data-virtual-index": number
  tabIndex: number
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>
  style?: CSSProperties
  virtualized: boolean
}

export type VirtualRowComponentProps<T, TContext> = VirtualRowProps & {
  item: T
  context: TContext
}

type BoundedVirtualListProps<T, TContext> = {
  items: ReadonlyArray<T>
  getKey: (item: T) => string
  rowComponent: ComponentType<VirtualRowComponentProps<T, TContext>>
  rowContext: TContext
  selectedIndex: number
  onMoveSelection: (index: number) => void
  ariaLabel: string
  rowHeight?: number
  threshold?: number
  overscan?: number
}

type VirtualListRowProps<T, TContext> = {
  item: T
  index: number
  count: number
  selectedIndex: number
  rowHeight: number
  virtualized: boolean
  rowComponent: ComponentType<VirtualRowComponentProps<T, TContext>>
  rowContext: TContext
  moveSelection: (index: number) => void
}

function VirtualListRow<T, TContext>({
  item,
  index,
  count,
  selectedIndex,
  rowHeight,
  virtualized,
  rowComponent,
  rowContext,
  moveSelection,
}: VirtualListRowProps<T, TContext>) {
  const Row = rowComponent
  const onKeyDown: KeyboardEventHandler<HTMLButtonElement> = (event) => {
    let next: number | null = null
    if (event.key === "ArrowDown") next = index + 1
    else if (event.key === "ArrowUp") next = index - 1
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = count - 1
    if (next == null) return
    event.preventDefault()
    moveSelection(next)
  }

  return (
    <div role="listitem" aria-posinset={index + 1} aria-setsize={count}>
      <Row
        item={item}
        context={rowContext}
        data-virtual-index={index}
        tabIndex={(selectedIndex >= 0 ? selectedIndex : 0) === index ? 0 : -1}
        style={virtualized ? { height: rowHeight, minHeight: rowHeight } : undefined}
        virtualized={virtualized}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

export function BoundedVirtualList<T, TContext>({
  items,
  getKey,
  rowComponent,
  rowContext,
  selectedIndex,
  onMoveSelection,
  ariaLabel,
  rowHeight = DEFAULT_VIRTUAL_ROW_HEIGHT,
  threshold = DEFAULT_THRESHOLD,
  overscan = DEFAULT_OVERSCAN,
}: BoundedVirtualListProps<T, TContext>) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusRef = useRef<number | null>(null)
  const previousSelectedRef = useRef<number | null>(null)
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0 })
  const virtualized = items.length >= threshold
  const window = useMemo(
    () => virtualized
      ? getVirtualWindow({ count: items.length, ...metrics, rowHeight, overscan })
      : { start: 0, end: items.length, offset: 0, total: 0 },
    [items.length, metrics, overscan, rowHeight, virtualized],
  )

  const readViewport = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setMetrics((current) => {
      const next = { scrollTop: viewport.scrollTop, viewportHeight: viewport.clientHeight }
      return current.scrollTop === next.scrollTop && current.viewportHeight === next.viewportHeight ? current : next
    })
  }, [])

  const scrollToIndex = useCallback((index: number) => {
    const viewport = viewportRef.current
    if (!viewport || index < 0 || index >= items.length) return
    const top = index * rowHeight
    const bottom = top + rowHeight
    const visibleTop = viewport.scrollTop
    const visibleBottom = visibleTop + viewport.clientHeight
    let nextTop = visibleTop
    if (top < visibleTop) nextTop = top
    else if (bottom > visibleBottom) nextTop = Math.max(0, bottom - viewport.clientHeight)
    if (nextTop !== visibleTop) viewport.scrollTop = nextTop
    setMetrics({ scrollTop: nextTop, viewportHeight: viewport.clientHeight })
  }, [items.length, rowHeight])

  useLayoutEffect(() => {
    readViewport()
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(readViewport)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [readViewport])

  useLayoutEffect(() => {
    if (selectedIndex < 0 || previousSelectedRef.current === selectedIndex) return
    previousSelectedRef.current = selectedIndex
    if (virtualized && (selectedIndex < window.start || selectedIndex >= window.end)) scrollToIndex(selectedIndex)
  }, [scrollToIndex, selectedIndex, virtualized, window.end, window.start])

  useLayoutEffect(() => {
    const index = pendingFocusRef.current
    const viewport = viewportRef.current
    if (index == null || !viewport) return
    const row = viewport.querySelector<HTMLButtonElement>(`[data-virtual-index="${index}"]`)
    if (!row) return
    pendingFocusRef.current = null
    row.focus()
  }, [selectedIndex, window.end, window.start])

  const moveSelection = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(items.length - 1, index))
    if (bounded < 0) return
    pendingFocusRef.current = bounded
    if (virtualized) scrollToIndex(bounded)
    onMoveSelection(bounded)
  }, [items.length, onMoveSelection, scrollToIndex, virtualized])

  const rows = items.slice(window.start, window.end).map((item, relativeIndex) => {
    const index = window.start + relativeIndex
    return (
      <VirtualListRow
        key={getKey(item)}
        item={item}
        index={index}
        count={items.length}
        selectedIndex={selectedIndex}
        rowHeight={rowHeight}
        virtualized={virtualized}
        rowComponent={rowComponent}
        rowContext={rowContext}
        moveSelection={moveSelection}
      />
    )
  })

  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={viewportRef}
      onViewportScroll={readViewport}
    >
      <div role="list" aria-label={ariaLabel}>
        {virtualized ? (
          <div className="relative" style={{ height: window.total }}>
            <div className="absolute inset-x-0 top-0" style={{ transform: `translateY(${window.offset}px)` }}>
              {rows}
            </div>
          </div>
        ) : rows}
      </div>
    </ScrollArea>
  )
}
