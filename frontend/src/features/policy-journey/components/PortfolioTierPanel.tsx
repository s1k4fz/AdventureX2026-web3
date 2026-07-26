import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FundPolicyButton } from '@/features/policy/FundPolicyButton'
import { MIN_PREMIUM_USDC } from '@/features/policy/policyStatus'
import type { PortfolioOut } from '@/features/policy/policyApi'
import {
  formatUsd,
  getPortfolioScenarios,
  scalePortfolioEconomics,
} from '@/features/policy/portfolioUtils'
import { cn } from '@/lib/utils'

import { TIER_LABELS } from './matrixColumns'

export interface PortfolioTierPanelProps {
  portfolio: PortfolioOut
  isSelected?: boolean
  dimmed?: boolean
  canEditPremium?: boolean
  premiumOverride?: number
  onPremiumChange?: (premium: number) => void
  policyId?: string
  isProposed?: boolean
  onSelectPortfolio?: (portfolioId: string) => void
  selecting?: boolean
  showPositionCount?: boolean
  index?: number
}

export function PortfolioTierPanel({
  portfolio,
  isSelected,
  dimmed,
  canEditPremium,
  premiumOverride,
  onPremiumChange,
  policyId,
  isProposed,
  onSelectPortfolio,
  selecting,
  showPositionCount,
  index = 0,
}: PortfolioTierPanelProps) {
  const [scenariosOpen, setScenariosOpen] = useState(false)
  const premium = premiumOverride ?? portfolio.premiumEstimate ?? 0
  const economics = scalePortfolioEconomics(portfolio, premium)
  const scenarios = getPortfolioScenarios(portfolio, premium)
  const tierLabel = TIER_LABELS[portfolio.tier]
  const hasSelectAction = Boolean(onSelectPortfolio)
  const hasFundAction = Boolean(policyId && isProposed && !onSelectPortfolio)

  const workingPortfolio =
    premiumOverride != null
      ? { ...portfolio, premiumEstimate: premiumOverride }
      : portfolio

  return (
    <article
      className={cn(
        'units-stagger flex flex-col rounded-xl border bg-background p-4 transition-[border-color,opacity,background-color] duration-300 units-ease motion-reduce:transition-none',
        isSelected
          ? 'border-[color-mix(in_srgb,var(--units-green)_45%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_7%,transparent)]'
          : 'border-[var(--units-stroke-color)]',
        dimmed && !isSelected && 'opacity-45'
      )}
      style={{ animationDelay: `${index * 60}ms` }}
      aria-label={`${tierLabel}${isSelected ? '，已选' : ''}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold tracking-tight text-foreground">
            {tierLabel}
          </p>
          {portfolio.title ? (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {portfolio.title}
            </p>
          ) : null}
        </div>
        {isSelected ? (
          <span className="shrink-0 text-[11px] font-semibold tracking-wide text-[var(--units-green)]">
            已选
          </span>
        ) : null}
      </header>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            保费
          </p>
          {canEditPremium && onPremiumChange ? (
            <div className="mt-1 flex items-baseline gap-1">
              <Input
                type="number"
                min={MIN_PREMIUM_USDC}
                step={10}
                value={premium}
                onChange={(event) => {
                  const next = parseFloat(event.target.value)
                  if (!Number.isNaN(next) && next >= MIN_PREMIUM_USDC) {
                    onPremiumChange(next)
                  }
                }}
                className="h-9 w-full max-w-[7.5rem] rounded-md border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-2 font-display text-[22px] font-semibold tracking-tight tabular-nums"
                aria-label={`${tierLabel} 保费`}
              />
              <span className="text-[11px] text-muted-foreground">USDC</span>
            </div>
          ) : (
            <p className="mt-1 font-display text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
              {formatUsd(premium)}
            </p>
          )}
        </div>

        <span
          className="mb-1.5 text-[13px] text-muted-foreground"
          aria-hidden
        >
          →
        </span>

        <div className="text-right">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            最大赔付
          </p>
          <p className="mt-1 font-display text-[26px] font-semibold leading-none tracking-tight tabular-nums text-[var(--units-orange)]">
            {formatUsd(economics.maxPayout)}
          </p>
        </div>
      </div>

      {portfolio.thesis ? (
        <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
          {portfolio.thesis}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] pt-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
          aria-expanded={scenariosOpen}
          onClick={() => setScenariosOpen((open) => !open)}
        >
          {scenariosOpen ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          情景分析
        </button>
        {showPositionCount ? (
          <span className="text-[12px] text-muted-foreground">
            {portfolio.positions.length} 个头寸
          </span>
        ) : null}
      </div>

      {scenariosOpen ? (
        <ul className="mt-2 space-y-1.5">
          {scenarios.map((row) => (
            <li
              key={row.label}
              className="flex items-baseline justify-between gap-3 text-[12px]"
            >
              <span className="text-muted-foreground">
                {row.label}
                {row.hitCount != null && row.totalCount != null ? (
                  <span className="ml-1 opacity-70">
                    ({row.hitCount}/{row.totalCount})
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  row.netProfit >= 0
                    ? 'text-[var(--units-green)]'
                    : 'text-rose-500'
                )}
              >
                {row.netProfit >= 0 ? '+' : ''}
                {formatUsd(row.netProfit)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasSelectAction ? (
        <div className="mt-4">
          <Button
            type="button"
            size="sm"
            disabled={selecting || isSelected}
            onClick={() => onSelectPortfolio?.(portfolio.id)}
            className={cn(
              'h-9 w-full rounded-lg border text-[13px] font-medium shadow-none motion-reduce:transition-none',
              isSelected
                ? 'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] text-foreground'
                : 'border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] text-foreground hover:bg-[color-mix(in_srgb,var(--units-orange)_22%,transparent)]'
            )}
          >
            {selecting && !isSelected ? (
              <Spinner className="mr-1 size-3.5" />
            ) : null}
            {isSelected ? '已选择' : '选择此档'}
          </Button>
        </div>
      ) : null}

      {hasFundAction && policyId ? (
        <div className="mt-4">
          <FundPolicyButton
            policyId={policyId}
            portfolioId={portfolio.id}
            portfolio={workingPortfolio}
            isProposed={Boolean(isProposed)}
          />
        </div>
      ) : null}
    </article>
  )
}
