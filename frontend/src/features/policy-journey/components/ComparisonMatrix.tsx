import { useCallback, useEffect, useMemo } from 'react'

import { GlobalContextPanel } from '@/features/policy/GlobalContextPanel'
import type { PortfolioOut, RiskFactorCategory } from '@/features/policy/policyApi'
import { OnChainPolicyId, TxLink } from '@/features/wallet/TxLink'
import { cn } from '@/lib/utils'

import { PortfolioTierPanel } from './PortfolioTierPanel'
import { TIER_ORDER } from './matrixColumns'
import { useMatrixSelection } from './useMatrixSelection'

export interface ComparisonMatrixProps {
  portfolios: PortfolioOut[]
  policyId?: string
  isProposed?: boolean
  selectedPortfolioId?: string | null
  onChainPolicyId?: string
  openTx?: string
  factorCategories?: RiskFactorCategory[]
  showGlobalContext?: boolean
  onSelectPortfolio?: (portfolioId: string) => void
  selecting?: boolean
}

export function ComparisonMatrix({
  portfolios,
  policyId,
  isProposed,
  selectedPortfolioId,
  onChainPolicyId,
  openTx,
  factorCategories,
  showGlobalContext = true,
  onSelectPortfolio,
  selecting,
}: ComparisonMatrixProps) {
  const {
    selectedId,
    setSelectedId,
    premiumOverrides,
    setPremium,
  } = useMatrixSelection(portfolios)

  useEffect(() => {
    if (selectedPortfolioId != null) {
      setSelectedId(selectedPortfolioId)
    }
  }, [selectedPortfolioId, setSelectedId])

  const handleSelectPortfolio = useCallback(
    (portfolioId: string) => {
      setSelectedId(portfolioId)
      onSelectPortfolio?.(portfolioId)
    },
    [onSelectPortfolio, setSelectedId]
  )

  const sortedPortfolios = useMemo(
    () =>
      [...portfolios].sort(
        (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
      ),
    [portfolios]
  )

  const activeSelectedId = selectedPortfolioId ?? selectedId

  const showPositionCount = useMemo(() => {
    if (sortedPortfolios.length < 2) return false
    const counts = new Set(
      sortedPortfolios.map((portfolio) => portfolio.positions.length)
    )
    return counts.size > 1
  }, [sortedPortfolios])

  /** Premium is editable only when funding from detail (proposed, no journey select). */
  const canEditPremium = Boolean(isProposed && policyId && !onSelectPortfolio)

  const hasLockedSelection =
    Boolean(activeSelectedId) && !isProposed && !onSelectPortfolio

  if (portfolios.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">暂无可用方案</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {showGlobalContext && (
        <GlobalContextPanel factorCategories={factorCategories} />
      )}

      <div
        className={cn(
          'grid gap-3',
          sortedPortfolios.length === 1
            ? 'max-w-md'
            : sortedPortfolios.length === 2
              ? 'sm:grid-cols-2'
              : 'sm:grid-cols-2 lg:grid-cols-3'
        )}
      >
        {sortedPortfolios.map((portfolio, index) => (
          <PortfolioTierPanel
            key={portfolio.id}
            portfolio={portfolio}
            index={index}
            isSelected={activeSelectedId === portfolio.id}
            dimmed={
              hasLockedSelection && activeSelectedId !== portfolio.id
            }
            canEditPremium={canEditPremium}
            premiumOverride={premiumOverrides[portfolio.id]}
            onPremiumChange={
              canEditPremium
                ? (premium) => setPremium(portfolio.id, premium)
                : undefined
            }
            policyId={policyId}
            isProposed={isProposed}
            onSelectPortfolio={
              onSelectPortfolio ? handleSelectPortfolio : undefined
            }
            selecting={selecting}
            showPositionCount={showPositionCount}
          />
        ))}
      </div>

      {(onChainPolicyId || openTx) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {onChainPolicyId ? (
            <span>
              链上保单 <OnChainPolicyId policyId={onChainPolicyId} />
            </span>
          ) : null}
          {openTx ? (
            <span>
              开保交易 <TxLink hash={openTx} />
            </span>
          ) : null}
        </p>
      )}
    </div>
  )
}
