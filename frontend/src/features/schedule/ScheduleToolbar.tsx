import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SCHEDULE_FILTER_LABELS,
  SCHEDULE_VIEW_LABELS,
  type ScheduleFilter,
  type ScheduleView,
} from './types'

interface ScheduleToolbarProps {
  view: ScheduleView
  filter: ScheduleFilter
  periodTitle: string
  onViewChange: (view: ScheduleView) => void
  onFilterChange: (filter: ScheduleFilter) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

const VIEWS: ScheduleView[] = ['month', 'week', 'day', 'agenda']
const FILTERS: ScheduleFilter[] = ['all', 'coverage_end', 'settled', 'attention']

export function ScheduleToolbar({
  view,
  filter,
  periodTitle,
  onViewChange,
  onFilterChange,
  onPrev,
  onNext,
  onToday,
}: ScheduleToolbarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">
            保障日程
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-full border border-[var(--units-stroke-color)] px-2.5 text-[11px]"
            onClick={onToday}
          >
            今天
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full border border-[var(--units-stroke-color)] bg-transparent"
            onClick={onPrev}
            aria-label="上一周期"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span
            key={periodTitle}
            className="units-schedule-title-swap min-w-[140px] text-center text-[14px] font-semibold tracking-tight"
          >
            {periodTitle}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full border border-[var(--units-stroke-color)] bg-transparent"
            onClick={onNext}
            aria-label="下一周期"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-[var(--units-stroke-color)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
                'transition-[color,background-color,transform] duration-200',
                view === v
                  ? 'bg-[var(--units-black)] text-[var(--units-cream)] shadow-none'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {SCHEDULE_VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFilterChange(f)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                filter === f
                  ? 'border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)] text-foreground'
                  : 'border-[var(--units-stroke-color)] text-muted-foreground hover:border-[var(--units-stroke-strong)]'
              )}
            >
              {SCHEDULE_FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
