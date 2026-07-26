import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ModelExplanation } from '@/features/policy-journey/types'
import { STAGE_LABELS } from '@/features/policy-journey/types'

const STATUS_LABELS: Record<ModelExplanation['status'], string> = {
  thinking: '思考中',
  tool_calling: '工具调用',
  verifying: '验证中',
  complete: '完成',
  error: '异常',
}

const STATUS_STYLES: Record<ModelExplanation['status'], string> = {
  thinking:
    'border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] text-foreground',
  tool_calling:
    'border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] text-foreground',
  verifying:
    'border-[var(--units-stroke-color)] bg-[var(--units-soft)] text-foreground',
  complete:
    'border-[var(--units-stroke-color)] bg-secondary text-muted-foreground',
  error:
    'border-[color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-destructive',
}

const TOOL_STATUS_STYLES = {
  running: 'bg-[var(--units-orange)]',
  done: 'bg-[color-mix(in_srgb,var(--units-black)_28%,transparent)]',
  error: 'bg-destructive',
} as const

export interface ModelObservationCardProps {
  explanation: ModelExplanation
  className?: string
  compact?: boolean
  onAction?: (explanation: ModelExplanation) => void
}

export function ModelObservationCard({
  explanation,
  className,
  compact = false,
  onAction,
}: ModelObservationCardProps) {
  const { summary, evidence, toolStatus, progress, status, action, stage } =
    explanation

  return (
    <article
      className={cn(
        'units-stage-enter flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-[var(--units-stroke-color)] bg-background p-3',
        className
      )}
    >
      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {!compact ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {STAGE_LABELS[stage]}
            </p>
          ) : null}
          <p
            className={cn(
              'mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 tracking-tight text-foreground',
              compact && 'mt-0'
            )}
          >
            {summary}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em]',
            STATUS_STYLES[status]
          )}
        >
          {STATUS_LABELS[status]}
        </span>
      </header>

      {evidence && evidence.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {evidence.map((item, index) => {
            const chip = (
              <span
                className={cn(
                  'flex w-full min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-full border border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-2 py-0.5 text-[11px] tracking-tight text-foreground',
                  item.url && 'hover:border-[var(--units-stroke-strong)]'
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.label}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  · {item.source}
                </span>
                {item.url ? (
                  <ExternalLink className="size-2.5 shrink-0 text-muted-foreground" />
                ) : null}
              </span>
            )

            if (item.url) {
              return (
                <a
                  key={`${item.source}-${item.label}-${index}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block min-w-0 max-w-full"
                >
                  {chip}
                </a>
              )
            }

            return (
              <span
                key={`${item.source}-${item.label}-${index}`}
                className="block min-w-0 max-w-full"
              >
                {chip}
              </span>
            )
          })}
        </div>
      ) : null}

      {toolStatus && toolStatus.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="工具状态">
          {toolStatus.map((tool) => (
            <li
              key={tool.name}
              className="flex items-center gap-2 rounded-lg border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_80%,transparent)] px-2 py-1.5"
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  TOOL_STATUS_STYLES[tool.status],
                  tool.status === 'running' && 'motion-reduce:opacity-80'
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[11px] tracking-tight text-foreground">
                {tool.name}
              </span>
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                {tool.status === 'running'
                  ? '运行中'
                  : tool.status === 'done'
                    ? '完成'
                    : '失败'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {typeof progress === 'number' ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>进度</span>
            <span>{Math.round(Math.min(100, Math.max(0, progress)))}%</span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[var(--units-orange)] transition-[width] duration-500 units-ease motion-reduce:transition-none"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      ) : null}

      {action ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full rounded-lg border-[var(--units-stroke-color)] bg-[var(--units-soft)] text-[11px] tracking-tight"
          onClick={() => onAction?.(explanation)}
        >
          {action.label}
        </Button>
      ) : null}
    </article>
  )
}
