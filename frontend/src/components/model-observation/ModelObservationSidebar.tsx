import { useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ModelExplanation } from '@/features/policy-journey/types'
import { ModelObservationCard } from './ModelObservationCard'
import { ModelTrace } from './ModelTrace'
import { useModelObservation } from './useModelObservation'

export interface ModelObservationSidebarProps {
  explanations: ModelExplanation[]
  className?: string
  defaultPinned?: boolean
  onAction?: (explanation: ModelExplanation) => void
}

export function ModelObservationSidebar({
  explanations,
  className,
  defaultPinned = true,
  onAction,
}: ModelObservationSidebarProps) {
  const [pinned, setPinned] = useState(defaultPinned)
  const { latest, history } = useModelObservation(explanations)

  return (
    <aside
      className={cn(
        'hidden w-[280px] shrink-0 flex-col border-s border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] lg:flex',
        pinned && 'sticky top-0 self-start',
        className
      )}
      aria-label="模型观测侧边栏"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--units-stroke-color)] px-3 py-2.5">
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
            模型观测
          </h2>
          <p className="text-[10px] tracking-[0.06em] text-muted-foreground">
            仅展示摘要与证据
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-md border border-transparent hover:border-[var(--units-stroke-color)]"
          aria-label={pinned ? '取消固定侧边栏' : '固定侧边栏'}
          aria-pressed={pinned}
          onClick={() => setPinned((value) => !value)}
        >
          {pinned ? (
            <Pin className="size-3.5 text-[var(--units-orange)]" />
          ) : (
            <PinOff className="size-3.5 text-muted-foreground" />
          )}
        </Button>
      </header>

      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-3">
        {latest ? (
          <ModelObservationCard explanation={latest} onAction={onAction} />
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--units-stroke-color)] bg-background/60 px-3 py-6 text-center">
            <p className="text-[11px] tracking-tight text-muted-foreground">
              暂无模型观测
            </p>
          </div>
        )}

        {history.length > 1 ? (
          <ModelTrace explanations={history} onAction={onAction} />
        ) : null}
      </div>
    </aside>
  )
}
