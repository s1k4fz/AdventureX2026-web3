import type { KeyboardEvent, ReactNode } from 'react'
import { Calendar, CircleCheckBig, Info } from 'lucide-react'
import { CircularProgress } from '@/components/CircularProgress'
import { PolicyStatusBadge } from '@/features/policy/PolicyStatusBadge'
import { cn } from '@/lib/utils'
import type { ScheduleUrgency } from './types'

interface TagDef {
  label: string
  bg: string
  text: string
}

export interface ScheduleTaskCardProps {
  title: string
  description: string
  tags: readonly TagDef[]
  dueDate: string
  progress: { completed: number; total: number }
  overdue?: boolean
  status?: string
  /** 与保单信息卡对齐的字段行（保费 / 赔付 / 档位等） */
  fields?: string[]
  countdown?: string | null
  healthHint?: string
  actionLabel?: string
  urgency?: ScheduleUrgency
  onClick?: () => void
  /** Trailing icon buttons (edit/delete). Avoids nested <button> inside card. */
  trailingActions?: ReactNode
}

export function TaskCard({
  title,
  description,
  tags,
  dueDate,
  progress,
  overdue,
  status,
  fields,
  countdown,
  healthHint,
  actionLabel = '定位日程',
  urgency = 'medium',
  onClick,
  trailingActions,
}: ScheduleTaskCardProps) {
  const { completed, total } = progress
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0
  const isDone = completed === total && total > 0

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full rounded-lg border border-border bg-background text-left transition-colors',
        onClick && 'cursor-pointer hover:bg-zinc-100/60'
      )}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {isDone ? (
            <CircleCheckBig className="size-4 shrink-0 text-green-500" />
          ) : (
            <CircularProgress value={percent} size={14} strokeWidth={2} />
          )}
          <h3 className="flex-1 truncate text-sm font-medium">{title}</h3>
          {trailingActions ? (
            <div
              className="flex items-center gap-0.5"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {trailingActions}
            </div>
          ) : overdue || urgency === 'critical' ? (
            <Info className="size-4 shrink-0 text-red-500" />
          ) : null}
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
          {description}
        </p>

        {healthHint ? (
          <p className="mt-1.5 line-clamp-1 text-[11px] text-muted-foreground">
            {healthHint}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {status ? <PolicyStatusBadge status={status} /> : null}
          {tags.map((tag) => (
            <span
              key={tag.label}
              className={`rounded-full border-transparent px-1.5 py-0.5 text-[10px] font-medium ${tag.bg} ${tag.text}`}
            >
              {tag.label}
            </span>
          ))}
        </div>

        {fields && fields.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {fields.map((field) => (
              <span key={field}>{field}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-dashed border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1">
              <Calendar className="size-3" />
              {dueDate}
            </span>
            {countdown ? (
              <span
                className={cn(
                  'rounded-sm border px-2 py-1',
                  countdown === '已到期'
                    ? 'border-red-200 text-red-500'
                    : 'border-border'
                )}
              >
                {countdown === '已到期' ? '已到期' : `剩余 ${countdown}`}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1">
              {isDone ? (
                <CircleCheckBig className="size-3.5 text-green-500" />
              ) : (
                <CircularProgress value={percent} size={14} strokeWidth={2} />
              )}
              {completed}/{total}
            </span>
          </div>
          {actionLabel ? (
            <span className="text-[11px] font-medium text-foreground">
              {actionLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
