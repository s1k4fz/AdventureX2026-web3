import { format, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { cn } from '@/lib/utils'
import type { ScheduleEvent } from './types'
import { KIND_DOT } from './scheduleKindStyles'
import {
  getMonthGridDays,
  groupEventsByDate,
  isInCurrentMonth,
  toDateKey,
} from './scheduleUtils'

interface ScheduleMonthGridProps {
  month: Date
  events: ScheduleEvent[]
  focusedEventId?: string | null
  focusDate?: string | null
  onSelectDay: (day: Date) => void
  className?: string
}

export function ScheduleMonthGrid({
  month,
  events,
  focusedEventId,
  focusDate,
  onSelectDay,
  className,
}: ScheduleMonthGridProps) {
  const days = getMonthGridDays(month)
  const byDate = groupEventsByDate(events)
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekdays.map((label) => (
          <div
            key={label}
            className="py-1 text-center text-[11px] font-semibold text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 gap-1">
        {days.map((day) => {
          const key = toDateKey(day)
          const dayEvents = byDate[key] ?? []
          const inMonth = isInCurrentMonth(day, month)
          const today = isToday(day)
          const isFocusedDay = focusDate === key
          const hasFocusedEvent = dayEvents.some((e) => e.id === focusedEventId)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(day)}
              className={cn(
                'flex min-h-[4.5rem] flex-col rounded-md border p-1.5 text-left transition-colors sm:min-h-[5.25rem]',
                inMonth
                  ? 'border-[var(--units-stroke-color)] bg-background/80 hover:border-[var(--units-stroke-strong)]'
                  : 'border-transparent bg-[color-mix(in_srgb,var(--units-black)_3%,transparent)] text-muted-foreground/70',
                (isFocusedDay || hasFocusedEvent) &&
                  'ring-2 ring-[var(--units-black)] ring-offset-1'
              )}
            >
              <span
                className={cn(
                  'mb-1 flex size-6 items-center justify-center rounded-full text-[12px] font-semibold',
                  today && 'bg-[var(--units-black)] text-[var(--units-cream)]'
                )}
              >
                {format(day, 'd')}
              </span>
              {dayEvents.length > 0 ? (
                <div className="mt-auto flex min-h-0 flex-col gap-0.5 overflow-hidden">
                  <div className="flex flex-wrap gap-0.5">
                    {dayEvents.slice(0, 4).map((event) => (
                      <span
                        key={event.id}
                        className={cn(
                          'size-1.5 rounded-full',
                          KIND_DOT[event.kind] ?? 'bg-muted-foreground',
                          focusedEventId === event.id &&
                            'ring-1 ring-[var(--units-black)] ring-offset-1'
                        )}
                        title={event.title}
                      />
                    ))}
                  </div>
                  <span className="truncate text-[9px] leading-tight text-muted-foreground">
                    {dayEvents.length} 项
                    {dayEvents[0]
                      ? ` · ${dayEvents[0].kindLabel ?? dayEvents[0].title}`
                      : ''}
                  </span>
                  {dayEvents.some(
                    (e) => e.urgency === 'critical' || e.urgency === 'high'
                  ) ? (
                    <span className="truncate text-[9px] font-medium text-[var(--units-orange)]">
                      有待办
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="sr-only">
                  {format(day, 'M月d日', { locale: zhCN })}无节点
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
