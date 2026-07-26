import { Clock, DollarSign, Shield, Timer } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PolicyOracleStatus } from './policyApi'

/**
 * Compact metrics card showing oracle configuration and ETA.
 * Used in monitoring and chain tabs alongside the full OracleStatusPanel.
 */
export function OracleMetricsCard({
  data,
}: {
  data: PolicyOracleStatus
}) {
  // Compute estimated finalization time based on legs still in Asserted state.
  const assertedLegs = data.legs.filter((l) => l.status === 1)
  const latestDeadline = assertedLegs.reduce(
    (max, leg) => Math.max(max, leg.challengeDeadline ?? 0),
    0
  )
  const nowSec = Math.floor(Date.now() / 1000)
  const etaSeconds = latestDeadline > nowSec ? latestDeadline - nowSec : 0

  const formatEta = (seconds: number): string => {
    if (seconds <= 0) return '—'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m > 0) return `~${m}分${s > 0 ? `${s}秒` : ''}`
    return `~${s}秒`
  }

  const disputeCount = data.legs.filter((l) => l.status === 2).length
  const resolvedCount = data.legs.filter((l) => l.status === 3).length
  const total = data.legs.length

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        预言机指标
      </h4>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricItem
          icon={<Timer className="size-3.5" />}
          label="挑战窗口"
          value={`${data.livenessSeconds}s`}
        />
        <MetricItem
          icon={<DollarSign className="size-3.5" />}
          label="保证金"
          value={`${data.bondUsdc} USDC`}
        />
        <MetricItem
          icon={<Clock className="size-3.5" />}
          label="预计完成"
          value={
            data.allResolved
              ? '已完成'
              : assertedLegs.length > 0
                ? formatEta(etaSeconds)
                : '等待断言'
          }
          highlight={!data.allResolved && etaSeconds > 0}
        />
        <MetricItem
          icon={<Shield className="size-3.5" />}
          label="确认进度"
          value={`${resolvedCount}/${total}`}
          sub={disputeCount > 0 ? `${disputeCount} 争议` : undefined}
          warn={disputeCount > 0}
        />
      </div>
    </div>
  )
}

function MetricItem({
  icon,
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: boolean
  warn?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <p
        className={cn(
          'font-mono text-sm font-semibold',
          warn
            ? 'text-amber-400'
            : highlight
              ? 'text-blue-400'
              : 'text-foreground'
        )}
      >
        {value}
      </p>
      {sub && (
        <span className="text-[10px] text-amber-400">{sub}</span>
      )}
    </div>
  )
}
