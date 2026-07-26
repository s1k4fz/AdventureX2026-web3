import { useMemo, useState } from 'react'
import { format, parseISO, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'

export type PolicyCalendarEventKind =
  | 'coverage_end'
  | 'resolution'
  | 'opened'
  | 'settled'
  | 'created'

export interface PolicyCalendarEvent {
  id: string
  date: string // ISO date or datetime
  label: string
  kind: PolicyCalendarEventKind
  href?: string
}

const KIND_DOT: Record<PolicyCalendarEventKind, string> = {
  coverage_end: 'bg-amber-500',
  resolution: 'bg-primary',
  opened: 'bg-emerald-500',
  settled: 'bg-emerald-400',
  created: 'bg-muted-foreground',
}

const KIND_LABEL: Record<PolicyCalendarEventKind, string> = {
  coverage_end: '保障截止',
  resolution: '市场到期',
  opened: '出资开保',
  settled: '结算完成',
  created: '创建',
}

function toDay(iso: string): Date | null {
  try {
    const d = parseISO(iso)
    if (Number.isNaN(d.getTime())) return null
    return startOfDay(d)
  } catch {
    return null
  }
}

/**
 * 复用 shadcn Calendar，按日聚合保单/头寸相关事件（到期、结算、开保等）。
 */
export function PolicyEventsCalendar({
  events,
  className,
  onSelectEvent,
}: {
  events: PolicyCalendarEvent[]
  className?: string
  onSelectEvent?: (event: PolicyCalendarEvent) => void
}) {
  const [month, setMonth] = useState<Date>(() => new Date())
  const [selected, setSelected] = useState<Date | undefined>()

  const eventsByDay = useMemo(() => {
    const map = new Map<string, PolicyCalendarEvent[]>()
    for (const event of events) {
      const day = toDay(event.date)
      if (!day) continue
      const key = format(day, 'yyyy-MM-dd')
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }
    return map
  }, [events])

  const markedDays = useMemo(
    () =>
      [...eventsByDay.keys()].map((key) => parseISO(key)).filter((d) => !Number.isNaN(d.getTime())),
    [eventsByDay]
  )

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : null
  const dayEvents = selectedKey ? (eventsByDay.get(selectedKey) ?? []) : []

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Calendar
        mode="single"
        locale={zhCN}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={setSelected}
        modifiers={{ hasEvent: markedDays }}
        modifiersClassNames={{
          hasEvent: 'relative font-semibold after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary',
        }}
        className="rounded-lg border border-border bg-secondary/20"
      />

      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {selected
            ? format(selected, 'yyyy年M月d日', { locale: zhCN })
            : '选择日期查看事件'}
        </p>
        {selected && dayEvents.length === 0 && (
          <p className="mt-2 text-[13px] text-muted-foreground">当日无保单相关事件</p>
        )}
        {dayEvents.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {dayEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-secondary/60"
                  onClick={() => onSelectEvent?.(event)}
                >
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      KIND_DOT[event.kind]
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-[11px] text-muted-foreground">
                      {KIND_LABEL[event.kind]}
                    </span>
                    <span className="block truncate text-[13px] text-foreground">
                      {event.label}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!selected && markedDays.length > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            已标记 {markedDays.length} 个事件日 · 点击日期查看详情
          </p>
        )}
      </div>
    </div>
  )
}

/** 从保单列表构造日历事件（看板用） */
export function eventsFromPolicyList(
  policies: Array<{
    id: string
    title: string
    coverageEnd: string | null
    status: string
    openTx?: string | null
    openedAt?: string | null
  }>
): PolicyCalendarEvent[] {
  const events: PolicyCalendarEvent[] = []
  for (const p of policies) {
    // The list projection intentionally stays small.  The backend records a
    // stable opening timestamp during confirm-open, avoiding a second API or
    // a separate calendar table.
    if (
      (p.status === 'active' || p.status === 'settled') &&
      p.openTx &&
      p.openedAt
    ) {
      events.push({
        id: `${p.id}-opened`,
        date: p.openedAt,
        label: p.title,
        kind: 'opened',
        href: `/policy/${p.id}`,
      })
    }
    if (p.coverageEnd) {
      events.push({
        id: `${p.id}-coverage`,
        date: p.coverageEnd,
        label: p.title,
        kind: p.status === 'settled' ? 'settled' : 'coverage_end',
        href: `/policy/${p.id}`,
      })
    }
  }
  return events
}

/** 从保单详情构造日历事件（详情页 / 工具卡用） */
export function eventsFromPolicyDetail(policy: {
  id: string
  title: string
  coverageEnd: string | null
  createdAt: string | null
  openTx: string | null
  settleTx: string | null
  updatedAt: string | null
  portfolios: Array<{
    positions: Array<{
      id: string
      question: string
      resolutionDate: string | null
    }>
  }>
}): PolicyCalendarEvent[] {
  const events: PolicyCalendarEvent[] = []
  if (policy.createdAt) {
    events.push({
      id: `${policy.id}-created`,
      date: policy.createdAt,
      label: '保单创建',
      kind: 'created',
    })
  }
  if (policy.coverageEnd) {
    events.push({
      id: `${policy.id}-coverage`,
      date: policy.coverageEnd,
      label: '保障截止 / 待结算',
      kind: 'coverage_end',
    })
  }
  if (policy.openTx && policy.updatedAt) {
    events.push({
      id: `${policy.id}-opened`,
      date: policy.updatedAt,
      label: '出资开保',
      kind: 'opened',
    })
  }
  if (policy.settleTx && policy.updatedAt) {
    events.push({
      id: `${policy.id}-settled`,
      date: policy.updatedAt,
      label: '链上结算完成',
      kind: 'settled',
    })
  }
  for (const portfolio of policy.portfolios) {
    for (const pos of portfolio.positions) {
      if (!pos.resolutionDate) continue
      events.push({
        id: `${pos.id}-res`,
        date: pos.resolutionDate,
        label: pos.question,
        kind: 'resolution',
      })
    }
  }
  return events
}
