import { format, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { cn } from '@/lib/utils'

interface ScheduleWeekHeaderProps {
  days: Date[]
  onSelectDay?: (day: Date) => void
}

export function ScheduleWeekHeader({
  days,
  onSelectDay,
}: ScheduleWeekHeaderProps) {
  return (
    <div className="flex border-b border-t border-border">
      {days.map((day) => {
        const today = isToday(day)
        return (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onSelectDay?.(day)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 border-r border-border py-2 text-xs last:border-r-0 transition-colors hover:bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)]',
              today ? 'font-semibold text-foreground' : 'text-muted-foreground'
            )}
          >
            <span>{format(day, 'EEE', { locale: zhCN })}</span>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full',
                today && 'bg-[var(--units-black)] text-[var(--units-cream)]'
              )}
            >
              {format(day, 'd')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
