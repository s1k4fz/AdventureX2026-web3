import { format, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { ScheduleEventCard } from './ScheduleEventCard'
import type { ScheduleEvent } from './types'
import { groupEventsByDate, toDateKey } from './scheduleUtils'

interface ScheduleDayViewProps {
  anchor: Date
  events: ScheduleEvent[]
  focusedEventId?: string | null
  onSelectEvent: (event: ScheduleEvent) => void
}

export function ScheduleDayView({
  anchor,
  events,
  focusedEventId,
  onSelectEvent,
}: ScheduleDayViewProps) {
  const key = toDateKey(anchor)
  const byDate = groupEventsByDate(events)
  const dayEvents = byDate[key] ?? []
  const today = isToday(anchor)

  return (
    <div className="scrollbar-hidden flex h-full flex-col overflow-y-auto p-4 sm:p-5">
      <div className="units-stage-enter mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {today ? '今天' : format(anchor, 'EEEE', { locale: zhCN })}
        </p>
        <h3 className="font-display text-xl font-semibold tracking-tight">
          {format(anchor, 'M月d日', { locale: zhCN })}
        </h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {dayEvents.length > 0
            ? `共 ${dayEvents.length} 个保障节点`
            : '当日暂无保障节点'}
        </p>
      </div>

      {dayEvents.length === 0 ? (
        <div className="units-stage-enter rounded-2xl border border-dashed border-[var(--units-stroke-strong)] px-4 py-12 text-center text-sm text-muted-foreground">
          这一天没有日程。可切到总览或议程查看其他日期。
        </div>
      ) : (
        <div className="units-stagger flex flex-col gap-3">
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
      )}
    </div>
  )
}
