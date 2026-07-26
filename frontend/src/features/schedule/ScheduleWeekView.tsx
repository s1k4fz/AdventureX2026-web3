import { useEffect, useRef } from 'react'
import { isToday } from 'date-fns'

import { cn } from '@/lib/utils'
import { ScheduleEventCard } from './ScheduleEventCard'
import { ScheduleWeekHeader } from './ScheduleWeekHeader'
import type { ScheduleEvent } from './types'
import { getWeekDays, groupEventsByDate, toDateKey } from './scheduleUtils'

interface ScheduleWeekViewProps {
  anchor: Date
  events: ScheduleEvent[]
  focusedEventId?: string | null
  onSelectDay: (day: Date) => void
  onSelectEvent: (event: ScheduleEvent) => void
}

export function ScheduleWeekView({
  anchor,
  events,
  focusedEventId,
  onSelectDay,
  onSelectEvent,
}: ScheduleWeekViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const days = getWeekDays(anchor)
  const byDate = groupEventsByDate(events)

  useEffect(() => {
    if (!focusedEventId || !rootRef.current) return
    const safeId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focusedEventId)
        : focusedEventId.replace(/"/g, '\\"')
    const node = rootRef.current.querySelector(`[data-event-id="${safeId}"]`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedEventId, events, anchor])

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden">
      <ScheduleWeekHeader days={days} onSelectDay={onSelectDay} />
      <div className="scrollbar-hidden flex min-h-0 flex-1">
        {days.map((day, colIdx) => {
          const key = toDateKey(day)
          const dayEvents = byDate[key] ?? []
          const today = isToday(day)
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5',
                colIdx < 6 && 'border-r border-border',
                today && 'bg-[color-mix(in_srgb,var(--units-blue)_5%,transparent)]'
              )}
            >
              {dayEvents.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className="units-stage-enter flex flex-1 items-start justify-center rounded-lg border border-dashed border-[var(--units-stroke-color)] px-1 py-4 text-[10px] text-muted-foreground"
                >
                  无节点
                </button>
              ) : (
                <div className="units-stagger flex flex-col gap-1.5">
                  {dayEvents.map((event) => (
                    <ScheduleEventCard
                      key={event.id}
                      event={event}
                      variant="compact"
                      focused={focusedEventId === event.id}
                      onSelect={onSelectEvent}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
