import { Link } from 'react-router-dom'

import type { ScheduleObservabilitySummary } from './policySchedule'
import { cn } from '@/lib/utils'

interface ScheduleObservabilityBarProps {
  summary: ScheduleObservabilitySummary
  className?: string
}

function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'orange' | 'green' | 'blue'
}) {
  if (value <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone === 'orange' &&
          'border-[color-mix(in_srgb,var(--units-orange)_45%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] text-[var(--units-orange)]',
        tone === 'green' &&
          'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_10%,transparent)] text-[var(--units-green)]',
        tone === 'blue' &&
          'border-[color-mix(in_srgb,var(--units-blue)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-blue)_10%,transparent)] text-[var(--units-blue)]',
        tone === 'neutral' &&
          'border-[var(--units-stroke-color)] text-muted-foreground'
      )}
    >
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  )
}

export function ScheduleObservabilityBar({
  summary,
  className,
}: ScheduleObservabilityBarProps) {
  const hasSignal =
    summary.pendingFund +
      summary.awaitingSettle +
      summary.waitingUser +
      summary.endingSoon +
      summary.monitoring +
      summary.activeCoverage +
      summary.settled >
    0

  if (!hasSignal) return null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        <Chip label="待结算" value={summary.awaitingSettle} tone="orange" />
        <Chip label="等待你" value={summary.waitingUser} tone="orange" />
        <Chip label="待出资" value={summary.pendingFund} tone="orange" />
        <Chip label="将截止" value={summary.endingSoon} tone="blue" />
        <Chip label="监控中" value={summary.monitoring} tone="green" />
        <Chip label="生效中" value={summary.activeCoverage} tone="green" />
        <Chip label="已结算" value={summary.settled} />
        <Chip label="可铸 NFT" value={summary.mintableNft} />
      </div>
      {(summary.pendingFund > 0 || summary.awaitingSettle > 0) && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          出资前可先在{' '}
          <Link
            to="/vault"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            金库
          </Link>{' '}
          核对余额；结算进度在保单详情健康度中查看。
        </p>
      )}
    </div>
  )
}
