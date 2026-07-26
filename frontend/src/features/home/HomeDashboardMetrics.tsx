import { ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface HomeDashboardStats {
  activeCount: number
  totalCoverage: number
  totalPremium: number
  pendingSettle: number
}

interface MetricPlateProps {
  label: string
  value: string
  hint: string
  plate: string
  ink?: boolean
  onClick?: () => void
}

function MetricPlate({
  label,
  value,
  hint,
  plate,
  ink = false,
  onClick,
}: MetricPlateProps) {
  const className = cn(
    'rounded-lg border border-zinc-200/80 p-3 text-left transition-colors',
    onClick && 'hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    plate,
    ink ? 'text-[var(--units-on-accent)]' : 'text-white'
  )

  const content = (
    <>
      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold tracking-wide opacity-90">
        {label}
        {onClick ? <ArrowUpRight className="size-3.5" /> : null}
      </span>
      <span className="mt-1 block text-[18px] font-semibold tracking-tight md:text-[19px]">
        {value}
      </span>
      <span className="mt-0.5 block text-[10.5px] leading-4 opacity-80">{hint}</span>
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    )
  }

  return <div className={className}>{content}</div>
}

interface HomeDashboardMetricsProps {
  stats: HomeDashboardStats
  formattedCoverage: string
  formattedPremium: string
  onFocusPending: () => void
}

export function HomeDashboardMetrics({
  stats,
  formattedCoverage,
  formattedPremium,
  onFocusPending,
}: HomeDashboardMetricsProps) {
  return (
    <section
      className="units-stagger grid grid-cols-2 gap-2 lg:grid-cols-4"
      aria-label="保障关键指标"
    >
      <MetricPlate
        label="生效保障"
        value={`${stats.activeCount} 份`}
        hint="当前由承保池覆盖"
        plate="bg-[var(--units-blue)]"
      />
      <MetricPlate
        label="在保额度"
        value={formattedCoverage}
        hint="生效保单最大赔付"
        plate="bg-[var(--units-green)]"
      />
      <MetricPlate
        label="累计保费"
        value={formattedPremium}
        hint="生效与已结算合计"
        plate="bg-[var(--units-lilac)]"
      />
      <MetricPlate
        label="待结算"
        value={`${stats.pendingSettle} 份`}
        hint={stats.pendingSettle > 0 ? '点击聚焦已到期保单' : '当前没有到期保单'}
        plate="bg-[var(--units-orange)]"
        ink
        onClick={stats.pendingSettle > 0 ? onFocusPending : undefined}
      />
    </section>
  )
}
