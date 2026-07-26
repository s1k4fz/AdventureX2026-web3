import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ModelExplanation } from '@/features/policy-journey/types'
import { STAGE_LABELS } from '@/features/policy-journey/types'
import { ModelObservationCard } from './ModelObservationCard'

export interface ModelTraceProps {
  explanations: ModelExplanation[]
  className?: string
  defaultOpen?: boolean
  /** newest first (default) or chronological */
  order?: 'newest' | 'chronological'
  onAction?: (explanation: ModelExplanation) => void
}

function sortExplanations(
  explanations: ModelExplanation[],
  order: 'newest' | 'chronological'
): ModelExplanation[] {
  return [...explanations].sort((a, b) => {
    const diff =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return order === 'chronological' ? diff : -diff
  })
}

function formatTraceTime(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function ModelTrace({
  explanations,
  className,
  defaultOpen = false,
  order = 'newest',
  onAction,
}: ModelTraceProps) {
  const sorted = sortExplanations(explanations, order)

  if (sorted.length === 0) {
    return null
  }

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn('rounded-xl border border-[var(--units-stroke-color)]', className)}
    >
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--units-soft)_60%,transparent)] motion-reduce:transition-none">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            观测轨迹
          </p>
          <p className="mt-0.5 text-[11px] tracking-tight text-foreground">
            {sorted.length} 条记录
          </p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 units-ease group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t border-[var(--units-stroke-color)] px-3 py-2.5">
        <ol className="relative flex flex-col gap-3">
          {sorted.map((item, index) => (
            <li key={item.id} className="relative flex gap-2.5">
              <div className="flex w-3 shrink-0 flex-col items-center pt-1">
                <span className="size-1.5 rounded-full bg-[var(--units-orange)]" />
                {index < sorted.length - 1 ? (
                  <span className="mt-1 w-px flex-1 bg-[var(--units-stroke-color)]" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="mb-1 flex items-center gap-2 text-[10px] tracking-[0.06em] text-muted-foreground">
                  <span>{STAGE_LABELS[item.stage]}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={item.createdAt}>
                    {formatTraceTime(item.createdAt)}
                  </time>
                </div>
                <ModelObservationCard
                  explanation={item}
                  compact
                  onAction={onAction}
                  className="units-stage-enter p-2.5"
                />
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}
