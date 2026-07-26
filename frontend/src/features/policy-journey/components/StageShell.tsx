import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { stageKicker, type JourneyStage } from '../types'

/**
 * Reading width of the stage body. `form` keeps line length comfortable for
 * questionnaires and prose; `board` lets comparison tables use the full canvas.
 */
export type StageMeasure = 'form' | 'board'

const MEASURE_CLASS: Record<StageMeasure, string> = {
  form: 'max-w-[46rem]',
  board: 'max-w-[68rem]',
}

export interface StageShellProps {
  stage: JourneyStage
  title: ReactNode
  description?: ReactNode
  /** Right-aligned slot in the header row (badge, counter, small action). */
  aside?: ReactNode
  /** Full-width slot directly below the header, inside the border (progress bar). */
  headerBelow?: ReactNode
  /** Pinned action bar; never scrolls away. */
  footer?: ReactNode
  measure?: StageMeasure
  /** Hide the "步骤 n / 5 · 名称" line when the stage renders its own kicker. */
  hideKicker?: boolean
  children?: ReactNode
  className?: string
}

/**
 * Shared frame for every journey stage: one header rhythm, one reading measure,
 * one scroll container, one pinned footer. Stages only supply content.
 */
export function StageShell({
  stage,
  title,
  description,
  aside,
  headerBelow,
  footer,
  measure = 'form',
  hideKicker = false,
  children,
  className,
}: StageShellProps) {
  return (
    <div
      data-stage={stage}
      className={cn(
        'units-stage-enter flex min-h-0 flex-1 flex-col',
        className
      )}
    >
      <div className="scrollbar-fade min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex w-full flex-col gap-6 px-5 pb-10 pt-6 md:px-8 md:pt-8',
            MEASURE_CLASS[measure]
          )}
        >
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                {hideKicker ? null : (
                  <p className="text-[12px] font-semibold tracking-tight text-muted-foreground">
                    {stageKicker(stage)}
                  </p>
                )}
                <h2 className="mt-1.5 font-display text-[26px] font-semibold leading-[1.25] tracking-tight text-foreground md:text-[30px]">
                  {title}
                </h2>
                {description ? (
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              {aside ? <div className="shrink-0 pt-1">{aside}</div> : null}
            </div>
            {headerBelow}
          </header>

          {children}
        </div>
      </div>

      {footer ? (
        <div className="shrink-0 border-t border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,#fff_92%,var(--units-soft))] px-5 py-3 md:px-8">
          <div
            className={cn('mx-auto w-full', MEASURE_CLASS[measure])}
          >
            {footer}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Shimmering placeholder block used by stage loading skeletons. */
export function StageSkeletonBlock({
  className,
  radius = 'rounded-xl',
}: {
  className?: string
  radius?: string
}) {
  return (
    <div
      aria-hidden
      className={cn('units-skeleton-shimmer', radius, className)}
    />
  )
}
