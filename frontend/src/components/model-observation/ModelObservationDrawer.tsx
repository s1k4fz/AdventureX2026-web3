import { useState } from 'react'
import { ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ModelExplanation } from '@/features/policy-journey/types'
import { ModelObservationCard } from './ModelObservationCard'
import { ModelTrace } from './ModelTrace'
import { useModelObservation } from './useModelObservation'

export interface ModelObservationDrawerProps {
  explanations: ModelExplanation[]
  className?: string
  onAction?: (explanation: ModelExplanation) => void
}

export function ModelObservationDrawer({
  explanations,
  className,
  onAction,
}: ModelObservationDrawerProps) {
  const [expanded, setExpanded] = useState(false)
  const { latest, history } = useModelObservation(explanations)

  if (!latest) {
    return null
  }

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 lg:hidden',
        className
      )}
      aria-label="模型观测抽屉"
    >
      <div
        className={cn(
          'flex max-h-[min(72vh,520px)] flex-col rounded-t-2xl border border-b-0 border-[var(--units-stroke-color)] bg-background shadow-[0_-8px_32px_color-mix(in_srgb,var(--units-black)_12%,transparent)] transition-transform duration-500 units-ease motion-reduce:transform-none motion-reduce:transition-none',
          expanded ? 'translate-y-0' : 'translate-y-[calc(100%-3.25rem)]'
        )}
      >
        <div className="flex items-center gap-2 border-b border-[var(--units-stroke-color)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              模型观测
            </p>
            <p className="truncate text-[11px] tracking-tight text-foreground">
              {latest.summary}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-lg border-[var(--units-stroke-color)]"
            aria-expanded={expanded}
            aria-label={expanded ? '收起观测详情' : '展开观测详情'}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronUp
              className={cn(
                'size-4 transition-transform duration-300 units-ease motion-reduce:transition-none',
                expanded && 'rotate-180'
              )}
            />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <ModelObservationCard explanation={latest} onAction={onAction} />

          {history.length > 1 ? (
            <ModelTrace explanations={history} onAction={onAction} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
