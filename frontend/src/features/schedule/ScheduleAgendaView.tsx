import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { ScheduleEventCard } from './ScheduleEventCard'
import type { ScheduleEvent } from './types'
import { groupEventsByDate, todayKey } from './scheduleUtils'
import { useEdgeSentinel } from './useEdgeSentinel'

const INITIAL_WINDOW = 18
const EXTEND_BY = 12

interface ScheduleAgendaViewProps {
  events: ScheduleEvent[]
  /** 工具栏翻页 / 今天时，跳到该月附近的日期窗口 */
  anchor?: Date
  focusedEventId?: string | null
  onSelectEvent: (event: ScheduleEvent) => void
  onVisibleRangeChange?: (range: {
    start: string
    end: string
    loaded: number
    total: number
  }) => void
}

export function ScheduleAgendaView({
  events,
  anchor,
  focusedEventId,
  onSelectEvent,
  onVisibleRangeChange,
}: ScheduleAgendaViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const byDate = useMemo(() => groupEventsByDate(events), [events])
  const allDates = useMemo(
    () => Object.keys(byDate).sort((a, b) => a.localeCompare(b)),
    [byDate]
  )
  const datesSignature = allDates.join('|')

  const initialBounds = useMemo(
    () => initialWindowBounds(allDates, focusedEventId, events),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when date set changes
    [datesSignature]
  )

  const [startIdx, setStartIdx] = useState(initialBounds.start)
  const [endIdx, setEndIdx] = useState(initialBounds.end)

  useEffect(() => {
    setStartIdx(initialBounds.start)
    setEndIdx(initialBounds.end)
  }, [initialBounds])

  const visibleDates = useMemo(
    () => allDates.slice(startIdx, endIdx),
    [allDates, startIdx, endIdx]
  )

  const canExtendPast = startIdx > 0
  const canExtendFuture = endIdx < allDates.length

  const extendPast = useCallback(() => {
    if (!canExtendPast) return
    const root = scrollRef.current
    const prevHeight = root?.scrollHeight ?? 0
    const prevTop = root?.scrollTop ?? 0
    setStartIdx((s) => Math.max(0, s - EXTEND_BY))
    requestAnimationFrame(() => {
      if (!scrollRef.current) return
      const delta = scrollRef.current.scrollHeight - prevHeight
      scrollRef.current.scrollTop = prevTop + delta
    })
  }, [canExtendPast])

  const extendFuture = useCallback(() => {
    if (!canExtendFuture) return
    setEndIdx((e) => Math.min(allDates.length, e + EXTEND_BY))
  }, [allDates.length, canExtendFuture])

  const topSentinelRef = useEdgeSentinel({
    root: scrollRef,
    onHit: extendPast,
    enabled: canExtendPast,
  })
  const bottomSentinelRef = useEdgeSentinel({
    root: scrollRef,
    onHit: extendFuture,
    enabled: canExtendFuture,
  })

  // 工具栏翻页 / 今天：按月跳转窗口（跳过首次挂载，避免覆盖初始聚焦窗口）
  const lastAgendaAnchorMonthRef = useRef<string | null>(null)
  useEffect(() => {
    if (!anchor || allDates.length === 0) return
    const monthKey = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`
    if (lastAgendaAnchorMonthRef.current === null) {
      lastAgendaAnchorMonthRef.current = monthKey
      return
    }
    if (lastAgendaAnchorMonthRef.current === monthKey) return
    lastAgendaAnchorMonthRef.current = monthKey

    let idx = allDates.findIndex((d) => d.startsWith(monthKey))
    if (idx < 0) {
      const monthStart = `${monthKey}-01`
      idx = allDates.findIndex((d) => d >= monthStart)
      if (idx < 0) idx = allDates.length - 1
    }
    const half = Math.floor(INITIAL_WINDOW / 2)
    let start = Math.max(0, idx - half)
    const end = Math.min(allDates.length, start + INITIAL_WINDOW)
    start = Math.max(0, end - INITIAL_WINDOW)
    setStartIdx(start)
    setEndIdx(end)

    const targetDate = allDates[idx]
    const t = window.setTimeout(() => {
      if (!targetDate || !scrollRef.current) return
      scrollRef.current
        .querySelector(`[data-agenda-date="${targetDate}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  useEffect(() => {
    if (!focusedEventId || !scrollRef.current) return
    const event = events.find((e) => e.id === focusedEventId)
    if (!event) return
    const idx = allDates.indexOf(event.date)
    if (idx < 0) return

    setStartIdx((s) => Math.min(s, Math.max(0, idx - 4)))
    setEndIdx((e) => Math.max(e, Math.min(allDates.length, idx + 5)))

    const safeId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focusedEventId)
        : focusedEventId.replace(/"/g, '\\"')

    const t = window.setTimeout(() => {
      scrollRef.current
        ?.querySelector(`[data-event-id="${safeId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 40)
    return () => window.clearTimeout(t)
  }, [focusedEventId, events, allDates])

  useLayoutEffect(() => {
    if (visibleDates.length === 0) {
      onVisibleRangeChange?.({ start: '', end: '', loaded: 0, total: 0 })
      return
    }
    onVisibleRangeChange?.({
      start: visibleDates[0]!,
      end: visibleDates[visibleDates.length - 1]!,
      loaded: visibleDates.length,
      total: allDates.length,
    })
  }, [visibleDates, allDates.length, onVisibleRangeChange])

  if (allDates.length === 0) {
    return (
      <div className="units-stage-enter flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">暂无保障节点可列入议程。</p>
        <p className="max-w-xs text-[12px] text-muted-foreground">
          待出资、将截止与结算节点会按日期出现在这里。
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="scrollbar-hidden h-full overflow-y-auto p-4 sm:p-5"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div
          ref={topSentinelRef}
          className="-mb-2 flex h-8 items-center justify-center text-[10px] text-muted-foreground"
        >
          {canExtendPast ? (
            <span className="units-schedule-edge-hint">向上加载更早日程</span>
          ) : (
            <span>已到最早节点</span>
          )}
        </div>

        {visibleDates.map((dateKey, sectionIndex) => {
          const dayEvents = byDate[dateKey] ?? []
          const day = parseISO(dateKey)
          return (
            <section
              key={dateKey}
              data-agenda-date={dateKey}
              className="units-schedule-section-enter flex flex-col gap-2.5"
              style={{ animationDelay: `${Math.min(sectionIndex, 8) * 40}ms` }}
            >
              <header className="sticky top-0 z-10 -mx-1 flex items-baseline justify-between gap-2 bg-background/95 px-1 py-1.5 backdrop-blur transition-shadow">
                <h3 className="text-sm font-semibold tracking-tight">
                  {format(day, 'M月d日 EEE', { locale: zhCN })}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {dayEvents.length} 项
                </span>
              </header>
              <div className="units-stagger flex flex-col gap-2">
                {dayEvents.map((event) => (
                  <ScheduleEventCard
                    key={event.id}
                    event={event}
                    variant="full"
                    focused={focusedEventId === event.id}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            </section>
          )
        })}

        <div
          ref={bottomSentinelRef}
          className="flex h-10 items-center justify-center text-[10px] text-muted-foreground"
        >
          {canExtendFuture ? (
            <span className="units-schedule-edge-hint">向下加载更晚日程</span>
          ) : (
            <span>
              已加载全部 {allDates.length} 天 · {events.length} 项
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function initialWindowBounds(
  allDates: string[],
  focusedEventId: string | null | undefined,
  events: ScheduleEvent[]
): { start: number; end: number } {
  if (allDates.length === 0) return { start: 0, end: 0 }

  let center = 0
  if (focusedEventId) {
    const focused = events.find((e) => e.id === focusedEventId)
    if (focused) {
      const idx = allDates.indexOf(focused.date)
      if (idx >= 0) center = idx
    }
  } else {
    const today = todayKey()
    const upcoming = allDates.findIndex((d) => d >= today)
    center = upcoming >= 0 ? upcoming : allDates.length - 1
  }

  const half = Math.floor(INITIAL_WINDOW / 2)
  let start = Math.max(0, center - half)
  const end = Math.min(allDates.length, start + INITIAL_WINDOW)
  start = Math.max(0, end - INITIAL_WINDOW)
  return { start, end }
}
