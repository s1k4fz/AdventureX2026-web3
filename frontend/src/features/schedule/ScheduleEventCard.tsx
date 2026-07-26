import type { ScheduleEvent } from './types'
import {
  inkOnAccent,
  SCHEDULE_COLOR_BG,
} from './scheduleKindStyles'
import { cn } from '@/lib/utils'

interface ScheduleEventCardProps {
  event: ScheduleEvent
  variant?: 'compact' | 'full'
  focused?: boolean
  onSelect?: (event: ScheduleEvent) => void
}

export function ScheduleEventCard({
  event,
  variant = 'compact',
  focused = false,
  onSelect,
}: ScheduleEventCardProps) {
  const bg = SCHEDULE_COLOR_BG[event.color] ?? SCHEDULE_COLOR_BG.blue
  const ink = inkOnAccent(event.color)
  const showCountdown =
    event.countdown &&
    (event.kind === 'coverage_end' ||
      event.kind === 'settle' ||
      event.urgency === 'critical' ||
      event.urgency === 'high')

  return (
    <button
      type="button"
      data-event-id={event.id}
      onClick={() => onSelect?.(event)}
      className={cn(
        'w-full overflow-hidden rounded-lg border border-[var(--units-stroke-color)] text-left shadow-[0_1px_0_color-mix(in_srgb,#000_8%,transparent)] transition-[filter,transform,box-shadow] hover:brightness-105 active:scale-[0.99]',
        bg,
        ink,
        focused &&
          'units-focus-pulse z-10 ring-2 ring-[var(--units-black)] ring-offset-2 ring-offset-background brightness-105',
        variant === 'compact' ? 'px-1.5 py-1' : 'px-2.5 py-2',
        (event.urgency === 'critical' || event.urgency === 'high') &&
          'ring-1 ring-[var(--units-black)]/20'
      )}
      title={[event.kindLabel, event.title, event.subtitle, event.nextActionLabel]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="flex items-center justify-between gap-1">
        {event.kindLabel ? (
          <span className="block truncate text-[9px] font-semibold uppercase tracking-[0.08em] opacity-80">
            {event.kindLabel}
          </span>
        ) : (
          <span />
        )}
        {showCountdown ? (
          <span className="shrink-0 rounded-full bg-black/15 px-1.5 py-0.5 text-[9px] font-semibold">
            {event.countdown === '已到期' ? '待结算' : event.countdown}
          </span>
        ) : null}
      </div>
      <div className="flex items-start gap-1">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current/70" />
        <span
          className={cn(
            'min-w-0 font-semibold leading-snug',
            variant === 'compact'
              ? 'line-clamp-2 text-[11px]'
              : 'line-clamp-2 text-xs'
          )}
        >
          {event.title}
        </span>
      </div>
      {variant === 'full' && event.goalSnippet ? (
        <p className="mt-0.5 line-clamp-2 pl-2.5 text-[10px] opacity-85">
          {event.goalSnippet}
        </p>
      ) : null}
      {variant === 'full' && event.subtitle ? (
        <p className="mt-0.5 line-clamp-1 pl-2.5 text-[10px] opacity-80">
          {event.subtitle}
        </p>
      ) : null}
      {variant === 'full' && event.meta && event.meta.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-2.5">
          {event.meta.slice(0, 4).map((item) => (
            <span
              key={item}
              className="rounded-full bg-black/15 px-1.5 py-0.5 text-[9px] font-medium"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {variant === 'compact' && (event.premiumLabel || event.meta?.[0]) ? (
        <p className="mt-0.5 truncate pl-2.5 text-[9px] opacity-75">
          {event.premiumLabel ?? event.meta?.[0]}
        </p>
      ) : null}
      {event.nextActionLabel ? (
        <p
          className={cn(
            'mt-1 truncate font-semibold opacity-95',
            variant === 'compact' ? 'pl-2.5 text-[9px]' : 'pl-2.5 text-[10px]'
          )}
        >
          → {event.nextActionLabel}
        </p>
      ) : null}
    </button>
  )
}
