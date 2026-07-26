import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'

import type { ScheduleEvent, ScheduleFilter, ScheduleView } from './types'

export function getWeekDays(referenceDate: Date = new Date()) {
  const monday = startOfWeek(referenceDate, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** 月历网格：从当月第一周周一到覆盖月末的完整周（通常 35 或 42 格） */
export function getMonthGridDays(referenceDate: Date = new Date()): Date[] {
  const monthStart = startOfMonth(referenceDate)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const monthEnd = endOfMonth(referenceDate)
  const gridEnd = startOfWeek(monthEnd, { weekStartsOn: 1 })
  // 至少覆盖到含月末的那一周周日
  const lastCell = addDays(gridEnd, 6)
  const days: Date[] = []
  let cursor = gridStart
  while (cursor <= lastCell) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  // 保证至少 5 行；不足则补满到 6 行便于布局稳定
  while (days.length < 42) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days.slice(0, 42)
}

export function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

export function groupEventsByDate(
  events: ScheduleEvent[]
): Record<string, ScheduleEvent[]> {
  const map: Record<string, ScheduleEvent[]> = {}
  for (const event of events) {
    ;(map[event.date] ??= []).push(event)
  }
  for (const key of Object.keys(map)) {
    map[key]!.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title))
  }
  return map
}

const ATTENTION_KINDS = new Set([
  'attention',
  'funding',
  'settle',
  'agent',
  'coverage_end',
  'nft',
  'custom',
])

export function filterScheduleEvents(
  events: ScheduleEvent[],
  filter: ScheduleFilter,
  attentionEventIds?: Set<string>
): ScheduleEvent[] {
  if (filter === 'all') return events
  if (filter === 'coverage_end') {
    return events.filter(
      (e) => e.kind === 'coverage_end' || e.kind === 'settle'
    )
  }
  if (filter === 'settled') {
    return events.filter((e) => e.kind === 'settled')
  }
  if (filter === 'attention') {
    if (attentionEventIds && attentionEventIds.size > 0) {
      return events.filter(
        (e) =>
          attentionEventIds.has(e.id) ||
          e.urgency === 'critical' ||
          e.urgency === 'high'
      )
    }
    return events.filter(
      (e) =>
        ATTENTION_KINDS.has(e.kind) ||
        e.urgency === 'critical' ||
        e.urgency === 'high'
    )
  }
  return events
}

function pickFocusEvent(
  events: ScheduleEvent[],
  now: Date = new Date()
): ScheduleEvent | null {
  if (events.length === 0) return null
  const key = todayKey(now)
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.find((event) => event.date >= key) ?? sorted[sorted.length - 1]!
}

/** 选最近的未过期事件周；若皆已过期则取最近的一条。 */
export function pickFocusWeekStart(
  events: ScheduleEvent[],
  now: Date = new Date()
): Date {
  const target = pickFocusEvent(events, now)
  if (!target) return startOfWeek(now, { weekStartsOn: 1 })
  return startOfWeek(parseISO(target.date), { weekStartsOn: 1 })
}

export function pickFocusMonth(
  events: ScheduleEvent[],
  now: Date = new Date()
): Date {
  const target = pickFocusEvent(events, now)
  if (!target) return startOfMonth(now)
  return startOfMonth(parseISO(target.date))
}

export function pickFocusDate(
  events: ScheduleEvent[],
  now: Date = new Date()
): Date {
  const target = pickFocusEvent(events, now)
  if (!target) return now
  return parseISO(target.date)
}

export function weekStartFromDateKey(dateKey: string): Date {
  return startOfWeek(parseISO(dateKey), { weekStartsOn: 1 })
}

export function shiftAnchor(
  view: ScheduleView,
  anchor: Date,
  direction: -1 | 1
): Date {
  if (view === 'month') {
    return direction === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1)
  }
  if (view === 'week') {
    return direction === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1)
  }
  if (view === 'day') {
    return addDays(anchor, direction)
  }
  // agenda：按月翻页浏览
  return direction === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1)
}

export function isInCurrentMonth(day: Date, anchor: Date): boolean {
  return isSameMonth(day, anchor)
}

export function formatPeriodTitle(view: ScheduleView, anchor: Date): string {
  if (view === 'day') {
    return format(anchor, 'yyyy年M月d日')
  }
  if (view === 'week') {
    const days = getWeekDays(anchor)
    const start = days[0]!
    const end = days[6]!
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'yyyy年M月d日')} – ${format(end, 'd日')}`
    }
    return `${format(start, 'yyyy年M月d日')} – ${format(end, 'M月d日')}`
  }
  return format(anchor, 'yyyy年M月')
}
