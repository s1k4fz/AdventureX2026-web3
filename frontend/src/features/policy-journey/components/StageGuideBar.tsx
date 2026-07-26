import { Eye, Hand, Sparkles, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { STAGE_GUIDES } from '../stageGuides'
import {
  JOURNEY_STAGES_ORDERED,
  STAGE_LABELS,
  type JourneyStage,
} from '../types'

export interface StageGuideBarProps {
  /** Stage the canvas is currently showing (live or reviewed). */
  stage: JourneyStage
  /** True when the user is blocked on an action at the live stage. */
  waitingUser?: boolean
  /** Read-only review mode: the canvas shows a past stage snapshot. */
  reviewing?: boolean
  onExitReview?: () => void
  /** Prefill the adjust panel with the reviewed stage context. */
  onAdjustFromStage?: (stage: JourneyStage) => void
  /** 右侧操作槽（如「调整需求」触发器），仅非回看态渲染。 */
  trailing?: ReactNode
  className?: string
}

/**
 * 画布顶部的一行式阶段指引：「这一步在做什么 / 需要你做什么 / 预计耗时」。
 * 回看模式下切换为只读快照提示 + 返回 / 基于此步调整入口。
 */
export function StageGuideBar({
  stage,
  waitingUser = false,
  reviewing = false,
  onExitReview,
  onAdjustFromStage,
  trailing,
  className,
}: StageGuideBarProps) {
  const guide = STAGE_GUIDES[stage]
  const index = JOURNEY_STAGES_ORDERED.indexOf(stage)
  const kicker = `步骤 ${index + 1} / ${JOURNEY_STAGES_ORDERED.length}`

  if (reviewing) {
    return (
      <div
        role="status"
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[color-mix(in_srgb,var(--units-blue)_25%,transparent)] bg-[color-mix(in_srgb,var(--units-blue)_7%,transparent)] px-4 py-2',
          className
        )}
      >
        <Eye className="size-3.5 shrink-0 text-[var(--units-blue)]" aria-hidden />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          正在回看「{STAGE_LABELS[stage]}」 · 只读快照，不影响任务进度
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {onAdjustFromStage ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 gap-1 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => onAdjustFromStage(stage)}
            >
              <Sparkles className="size-3" />
              基于此步提出调整
            </Button>
          ) : null}
          {onExitReview ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-7 gap-1 rounded-full border-[var(--units-stroke-color)] px-2.5 text-[12px]"
              onClick={onExitReview}
            >
              <Undo2 className="size-3" />
              回到当前步骤
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_45%,transparent)] px-4 py-2',
        className
      )}
    >
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
        {kicker}
      </span>
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        {guide.what}
        {guide.estimate ? (
          <span className="ml-1.5 text-muted-foreground/70">
            · {guide.estimate}
          </span>
        ) : null}
      </p>
      <p
        className={cn(
          'flex shrink-0 items-center gap-1 text-[12px]',
          waitingUser
            ? 'font-semibold text-[var(--units-orange)]'
            : 'text-muted-foreground'
        )}
      >
        {waitingUser ? <Hand className="size-3" aria-hidden /> : null}
        {waitingUser ? `待你操作：${guide.you}` : guide.you}
      </p>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  )
}
