import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { addMonths, format, startOfMonth, subMonths } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { ScheduleMonthGrid } from './ScheduleMonthGrid'
import {
  buildMonthRange,
  monthKeyEquals,
  toMonthKey,
} from './monthScrollUtils'
import type { ScheduleEvent } from './types'
import { useEdgeSentinel } from './useEdgeSentinel'

const INITIAL_BEFORE = 1
const INITIAL_AFTER = 2
const EXTEND_BY = 2
const MAX_MONTHS = 36

interface ScheduleMonthViewProps {
  anchor: Date
  events: ScheduleEvent[]
  focusedEventId?: string | null
  focusDate?: string | null
  onSelectDay: (day: Date) => void
  /** 滚动使某月成为主可见月时回调，用于同步工具栏标题 */
  onVisibleMonthChange?: (month: Date) => void
}

export function ScheduleMonthView({
  anchor,
  events,
  focusedEventId,
  focusDate,
  onSelectDay,
  onVisibleMonthChange,
}: ScheduleMonthViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const suppressVisibleRef = useRef(false)
  const pendingScrollMonthRef = useRef<string | null>(null)
  const lastReportedKeyRef = useRef(toMonthKey(anchor))

  const [months, setMonths] = useState(() =>
    buildMonthRange(anchor, INITIAL_BEFORE, INITIAL_AFTER)
  )

  const monthKeys = useMemo(() => months.map(toMonthKey).join('|'), [months])

  const ensureMonthInRange = useCallback((target: Date) => {
    const targetStart = startOfMonth(target)
    setMonths((prev) => {
      const first = prev[0]
      const last = prev[prev.length - 1]
      if (!first || !last) {
        return buildMonthRange(targetStart, INITIAL_BEFORE, INITIAL_AFTER)
      }
      if (targetStart >= first && targetStart <= last) return prev

      if (targetStart < first) {
        const gap =
          (first.getFullYear() - targetStart.getFullYear()) * 12 +
          (first.getMonth() - targetStart.getMonth())
        const prepend = Array.from({ length: gap + INITIAL_BEFORE }, (_, i) =>
          subMonths(first, gap + INITIAL_BEFORE - i)
        )
        return trimMonths([...prepend, ...prev], targetStart)
      }

      const gap =
        (targetStart.getFullYear() - last.getFullYear()) * 12 +
        (targetStart.getMonth() - last.getMonth())
      const append = Array.from({ length: gap + INITIAL_AFTER }, (_, i) =>
        addMonths(last, i + 1)
      )
      return trimMonths([...prev, ...append], targetStart)
    })
  }, [])

  const scrollToMonth = useCallback((target: Date, behavior: ScrollBehavior = 'smooth') => {
    const key = toMonthKey(target)
    pendingScrollMonthRef.current = key
    suppressVisibleRef.current = true
    ensureMonthInRange(target)

    requestAnimationFrame(() => {
      const root = scrollRef.current
      const node = root?.querySelector<HTMLElement>(`[data-month-key="${key}"]`)
      if (node && root) {
        const top = node.offsetTop - 8
        root.scrollTo({ top, behavior })
      }
      window.setTimeout(() => {
        suppressVisibleRef.current = false
        pendingScrollMonthRef.current = null
      }, behavior === 'smooth' ? 420 : 80)
    })
  }, [ensureMonthInRange])

  // 外部翻页 / 今天：滚到目标月
  useEffect(() => {
    const key = toMonthKey(anchor)
    if (key === lastReportedKeyRef.current && !pendingScrollMonthRef.current) {
      // 仍确保在范围内（初次挂载）
      ensureMonthInRange(anchor)
      return
    }
    if (key === lastReportedKeyRef.current) return
    lastReportedKeyRef.current = key
    scrollToMonth(anchor)
  }, [anchor, ensureMonthInRange, scrollToMonth])

  // 初次定位到 anchor（无动画）
  useLayoutEffect(() => {
    const root = scrollRef.current
    const key = toMonthKey(anchor)
    const node = root?.querySelector<HTMLElement>(`[data-month-key="${key}"]`)
    if (node && root) {
      root.scrollTop = Math.max(0, node.offsetTop - 8)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  const extendPast = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const prevHeight = root.scrollHeight
    const prevTop = root.scrollTop

    setMonths((prev) => {
      const first = prev[0]
      if (!first || prev.length >= MAX_MONTHS) return prev
      const prepend = Array.from({ length: EXTEND_BY }, (_, i) =>
        subMonths(first, EXTEND_BY - i)
      )
      return trimMonths([...prepend, ...prev], startOfMonth(anchor))
    })

    requestAnimationFrame(() => {
      if (!scrollRef.current) return
      const delta = scrollRef.current.scrollHeight - prevHeight
      scrollRef.current.scrollTop = prevTop + delta
    })
  }, [anchor])

  const extendFuture = useCallback(() => {
    setMonths((prev) => {
      const last = prev[prev.length - 1]
      if (!last || prev.length >= MAX_MONTHS) return prev
      const append = Array.from({ length: EXTEND_BY }, (_, i) =>
        addMonths(last, i + 1)
      )
      return trimMonths([...prev, ...append], startOfMonth(anchor))
    })
  }, [anchor])

  const topSentinelRef = useEdgeSentinel({
    root: scrollRef,
    onHit: extendPast,
    enabled: months.length < MAX_MONTHS,
  })
  const bottomSentinelRef = useEdgeSentinel({
    root: scrollRef,
    onHit: extendFuture,
    enabled: months.length < MAX_MONTHS,
  })

  // 可见月检测
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !onVisibleMonthChange) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressVisibleRef.current) return
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        const best = visible[0]
        if (!best) return
        const key = (best.target as HTMLElement).dataset.monthKey
        if (!key || key === lastReportedKeyRef.current) return
        lastReportedKeyRef.current = key
        const [y, m] = key.split('-').map(Number)
        if (!y || !m) return
        onVisibleMonthChange(new Date(y, m - 1, 1))
      },
      {
        root,
        threshold: [0.35, 0.55, 0.75],
        rootMargin: '-10% 0px -45% 0px',
      }
    )

    const nodes = root.querySelectorAll<HTMLElement>('[data-month-key]')
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [monthKeys, onVisibleMonthChange])

  return (
    <div
      ref={scrollRef}
      className="scrollbar-hidden h-full overflow-y-auto px-3 py-3 sm:px-4 sm:py-4"
    >
      <div
        ref={topSentinelRef}
        className="flex h-8 items-center justify-center text-[10px] text-muted-foreground"
        aria-hidden
      >
        <span className="units-schedule-edge-hint">向上加载更早月份</span>
      </div>

      <div className="flex flex-col gap-8">
        {months.map((month) => {
          const key = toMonthKey(month)
          const isActive = monthKeyEquals(month, anchor)
          return (
            <section
              key={key}
              data-month-key={key}
              className="units-schedule-month-enter scroll-mt-2"
            >
              <header className="mb-2 flex items-baseline justify-between gap-2 px-0.5">
                <h3
                  className={
                    isActive
                      ? 'text-sm font-semibold tracking-tight text-foreground'
                      : 'text-sm font-medium tracking-tight text-muted-foreground'
                  }
                >
                  {format(month, 'yyyy年M月', { locale: zhCN })}
                </h3>
                {isActive ? (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    当前
                  </span>
                ) : null}
              </header>
              <ScheduleMonthGrid
                month={month}
                events={events}
                focusedEventId={focusedEventId}
                focusDate={focusDate}
                onSelectDay={onSelectDay}
              />
            </section>
          )
        })}
      </div>

      <div
        ref={bottomSentinelRef}
        className="mt-4 flex h-10 items-center justify-center text-[10px] text-muted-foreground"
        aria-hidden
      >
        <span className="units-schedule-edge-hint">向下加载更晚月份</span>
      </div>
    </div>
  )
}

function trimMonths(months: Date[], keepNear: Date): Date[] {
  if (months.length <= MAX_MONTHS) return months
  const keepKey = toMonthKey(keepNear)
  const keepIdx = months.findIndex((m) => toMonthKey(m) === keepKey)
  if (keepIdx < 0) return months.slice(0, MAX_MONTHS)
  const half = Math.floor(MAX_MONTHS / 2)
  let start = Math.max(0, keepIdx - half)
  let end = start + MAX_MONTHS
  if (end > months.length) {
    end = months.length
    start = Math.max(0, end - MAX_MONTHS)
  }
  return months.slice(start, end)
}
