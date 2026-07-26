import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { PolicyFlowStatus } from '../policyFlowStatus'
import {
  JOURNEY_STAGES_ORDERED,
  STAGE_LABELS,
  type JourneyStage,
  type StageStatus,
} from '../types'
import { PolicyFlowStatusBadge } from './PolicyFlowStatusBadge'

export interface JourneyTrackProps {
  /** Where the flow actually is. Drives the “进行中” marker and gating. */
  currentStage: JourneyStage
  /** Which stage the canvas is showing. Defaults to `currentStage`. */
  viewStage?: JourneyStage
  stages: Record<JourneyStage, StageStatus>
  onSelectStage?: (stage: JourneyStage) => void
  /** Resolved single source of truth for the footer status + next step. */
  flowStatus?: PolicyFlowStatus | null
  /**
   * Compact text progress under 采集情报 (e.g. “采集中 · 2/5”).
   * Avatars stay in the canvas so the same information is not drawn twice.
   */
  collectHint?: ReactNode
  className?: string
}

type RowState = 'done' | 'active' | 'failed' | 'future'

function rowState(
  status: StageStatus,
  isCurrent: boolean,
  isPast: boolean
): RowState {
  if (status === 'failed' && isCurrent) return 'failed'
  // Past the flow cursor ⇒ completed even if status lagged on waiting_confirmation.
  if (isPast || (status === 'success' && !isCurrent)) return 'done'
  if (isCurrent) return 'active'
  if (status === 'success') return 'done'
  return 'future'
}

function StageStatusIndicator({
  state,
  index,
}: {
  state: RowState
  index: number
}) {
  if (state === 'done') {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--units-green)_38%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_14%,transparent)]"
        aria-hidden
      >
        <Check
          className="size-3.5 text-[var(--units-green)]"
          strokeWidth={2.75}
        />
      </span>
    )
  }

  if (state === 'failed') {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--destructive)_38%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)]"
        aria-hidden
      >
        <X className="size-3.5 text-destructive" strokeWidth={2.75} />
      </span>
    )
  }

  if (state === 'active') {
    return (
      <span className="relative flex size-6 shrink-0 items-center justify-center" aria-hidden>
        <span className="units-stage-pulse absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--units-orange)_28%,transparent)]" />
        <span className="relative flex size-6 items-center justify-center rounded-full bg-[var(--units-orange)]">
          <span className="size-2 rounded-full bg-[var(--units-on-accent)]" />
        </span>
      </span>
    )
  }

  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--units-black)_20%,transparent)] text-[11px] font-semibold text-muted-foreground"
      aria-hidden
    >
      {index + 1}
    </span>
  )
}

function futureBlockedReason(stage: JourneyStage): string {
  return `请先完成当前步骤后再进入「${STAGE_LABELS[stage]}」`
}

export function JourneyTrack({
  currentStage,
  viewStage,
  stages,
  onSelectStage,
  flowStatus = null,
  collectHint = null,
  className,
}: JourneyTrackProps) {
  const currentIndex = JOURNEY_STAGES_ORDERED.indexOf(currentStage)
  const focusedStage = viewStage ?? currentStage
  const total = JOURNEY_STAGES_ORDERED.length
  const doneCount = JOURNEY_STAGES_ORDERED.filter((stage, index) => {
    if (index < currentIndex) return true
    return stages[stage] === 'success'
  }).length

  const rows = JOURNEY_STAGES_ORDERED.map((stage, index) => {
    const status = stages[stage]
    const isCurrent = stage === currentStage
    const isPast = index < currentIndex
    const completed = status === 'success' || isPast
    const future = index > currentIndex && !completed
    return {
      stage,
      index,
      status,
      isCurrent,
      isFocused: stage === focusedStage,
      future,
      state: rowState(status, isCurrent, isPast),
      canSelect: Boolean(onSelectStage) && (completed || isCurrent),
    }
  })

  return (
    <nav
      aria-label="保障流程"
      className={cn(
        'units-stage-enter flex min-w-0 shrink-0 flex-col border-b border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] lg:h-full lg:w-full lg:border-b-0 lg:border-e',
        className
      )}
    >
      {/* Desktop vertical rail */}
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <div className="flex items-baseline justify-between gap-2 px-4 pb-3 pt-4">
          <p className="text-[12px] font-semibold tracking-tight text-muted-foreground">
            保障流程
          </p>
          <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {doneCount}/{total}
          </p>
        </div>

        <ol className="scrollbar-fade flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 pb-2">
          {rows.map((row, position) => (
            <li key={row.stage} className="relative">
              {position < rows.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-0 left-5 top-8 w-px -translate-x-1/2',
                    row.state === 'done'
                      ? 'bg-[color-mix(in_srgb,var(--units-green)_38%,transparent)]'
                      : 'bg-[color-mix(in_srgb,var(--units-black)_12%,transparent)]'
                  )}
                />
              ) : null}
              <button
                type="button"
                disabled={!row.canSelect}
                title={row.future ? futureBlockedReason(row.stage) : undefined}
                onClick={() => {
                  if (row.canSelect) onSelectStage?.(row.stage)
                }}
                aria-current={row.isCurrent ? 'step' : undefined}
                className={cn(
                  'units-ease relative flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors motion-reduce:transition-none',
                  row.isFocused &&
                    'bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)]',
                  row.canSelect &&
                    !row.isFocused &&
                    'hover:bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)]',
                  row.future && 'cursor-not-allowed'
                )}
              >
                <StageStatusIndicator state={row.state} index={row.index} />
                <span className="min-w-0 flex-1 pt-0.5">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-semibold tracking-tight',
                      row.future ? 'text-muted-foreground' : 'text-foreground'
                    )}
                  >
                    {STAGE_LABELS[row.stage]}
                  </span>
                  {row.isCurrent && !row.isFocused ? (
                    <span className="mt-0.5 block text-[11px] font-medium text-[var(--units-orange)]">
                      进行中
                    </span>
                  ) : null}
                  {row.stage === 'market_research' && collectHint ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                      {collectHint}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {flowStatus && flowStatus.kind !== 'awaiting_fill' ? (
          <div className="mt-auto flex flex-col gap-2 border-t border-[var(--units-stroke-color)] px-4 py-3.5">
            <PolicyFlowStatusBadge status={flowStatus} className="self-start" />
            <p className="text-[12.5px] font-medium leading-5 text-foreground">
              {flowStatus.nextHint}
            </p>
          </div>
        ) : null}
      </div>

      {/* Tablet: horizontal step strip */}
      <div className="hidden items-stretch gap-1 overflow-x-auto p-2 md:flex lg:hidden">
        {rows.map((row) => (
          <button
            key={row.stage}
            type="button"
            disabled={!row.canSelect}
            title={row.future ? futureBlockedReason(row.stage) : undefined}
            onClick={() => {
              if (row.canSelect) onSelectStage?.(row.stage)
            }}
            aria-current={row.isCurrent ? 'step' : undefined}
            className={cn(
              'flex min-w-[7rem] items-center gap-2 rounded-xl px-2.5 py-2 text-left',
              row.isFocused
                ? 'bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--units-orange)_28%,transparent)]'
                : 'bg-transparent'
            )}
          >
            <StageStatusIndicator state={row.state} index={row.index} />
            <span
              className={cn(
                'truncate text-[12px] font-semibold',
                row.future ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              {STAGE_LABELS[row.stage]}
            </span>
          </button>
        ))}
      </div>

      {/* Mobile: dot strip keeps navigation instead of collapsing to a counter */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:hidden">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">
            步骤 {currentIndex + 1} / {total}
          </p>
          <p className="truncate text-[14px] font-semibold text-foreground">
            {STAGE_LABELS[focusedStage]}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {rows.map((row) => (
            <button
              key={row.stage}
              type="button"
              disabled={!row.canSelect}
              aria-label={STAGE_LABELS[row.stage]}
              aria-current={row.isCurrent ? 'step' : undefined}
              onClick={() => {
                if (row.canSelect) onSelectStage?.(row.stage)
              }}
              className={cn(
                'size-2.5 rounded-full transition-colors motion-reduce:transition-none',
                row.isFocused
                  ? 'bg-[var(--units-orange)]'
                  : row.state === 'done'
                    ? 'bg-[color-mix(in_srgb,var(--units-green)_60%,transparent)]'
                    : row.state === 'failed'
                      ? 'bg-destructive'
                      : 'bg-[color-mix(in_srgb,var(--units-black)_18%,transparent)]'
              )}
            />
          ))}
        </div>
      </div>
    </nav>
  )
}
