import { cn } from '@/lib/utils'
import type { HealthScore } from './PolicyHealthScore'

const SEVERITY_CLASS = {
  low: 'border-[var(--units-stroke-color)] text-muted-foreground',
  medium:
    'border-[color-mix(in_srgb,var(--units-orange)_40%,transparent)] text-[var(--units-orange)]',
  high: 'border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] text-destructive',
} as const

export function HealthScoreCard({
  health,
  className,
  onNextAction,
}: {
  health: HealthScore
  className?: string
  onNextAction?: () => void
}) {
  return (
    <section
      className={cn(
        'units-stage-enter rounded-2xl border border-[var(--units-stroke-color)] bg-[var(--units-soft)] p-4',
        className
      )}
      aria-label="保单健康分"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Health Score
          </p>
          <p className="font-display mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {health.score}
            <span className="ml-2 text-base font-medium text-muted-foreground">
              {health.label}
            </span>
          </p>
        </div>
        <div
          className="h-2 w-28 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-[var(--units-orange)] transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${health.score}%` }}
          />
        </div>
      </div>

      {health.keyRisks.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {health.keyRisks.map((risk) => (
            <li
              key={risk.id}
              className={cn(
                'rounded-xl border bg-background/70 px-3 py-2 text-[12px] font-medium',
                SEVERITY_CLASS[risk.severity]
              )}
            >
              {risk.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          当前未见显著风险信号
        </p>
      )}

      {health.nextAction ? (
        <button
          type="button"
          onClick={onNextAction}
          className="units-cta mt-4 h-9 rounded-full px-4 text-sm font-semibold"
        >
          {health.nextAction.label}
        </button>
      ) : null}
    </section>
  )
}
