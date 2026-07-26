import type {
  PortfolioMetrics,
  PortfolioOut,
  PortfolioScenario,
  PositionOut,
} from './policyApi'

const LOW_LIQUIDITY_THRESHOLD = 5_000
const LOW_VOLUME_THRESHOLD = 1_000
const WIDE_SPREAD_BPS = 500

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`
}

export function isLowLiquidityPosition(position: PositionOut): boolean {
  if (position.lowLiquidity === true) return true
  if (position.liquidity != null && position.liquidity < LOW_LIQUIDITY_THRESHOLD) {
    return true
  }
  if (position.volume != null && position.volume < LOW_VOLUME_THRESHOLD) {
    return true
  }
  if (position.spreadBps != null && position.spreadBps >= WIDE_SPREAD_BPS) {
    return true
  }
  return false
}

export function computePortfolioMetrics(
  portfolio: PortfolioOut
): PortfolioMetrics {
  const backend = portfolio.metrics
  const premium = portfolio.premiumEstimate ?? 0
  const expectedPayout = portfolio.expectedPayout ?? 0
  const positions = portfolio.positions

  const totalWeight = positions.reduce((sum, p) => sum + p.weight, 0) || 10_000
  const avgEntryProbability =
    backend?.avgEntryProbability ??
    (positions.length > 0
      ? positions.reduce(
          (sum, p) => sum + p.entryPriceBps * (p.weight / totalWeight),
          0
        ) / 100
      : null)

  const categories = new Set(
    positions.map((p) => p.category).filter(Boolean)
  )
  const marketDiversity =
    backend?.marketDiversity ??
    (categories.size > 0 ? categories.size : positions.length || null)

  const resolutionDates = positions
    .map((p) => p.resolutionDate)
    .filter(Boolean) as string[]
  const nearestResolutionDate =
    backend?.nearestResolutionDate ??
    (resolutionDates.length > 0
      ? resolutionDates.sort()[0]
      : null)

  const multiplier = premium > 0 ? expectedPayout / premium : 0
  const breakevenHitRate =
    backend?.breakevenHitRate ??
    (multiplier > 0 ? (1 / multiplier) * 100 : null)

  return {
    avgEntryProbability,
    marketDiversity,
    nearestResolutionDate,
    breakevenHitRate,
    impliedAnnualOdds: backend?.impliedAnnualOdds ?? null,
    portfolioHitProbability: backend?.portfolioHitProbability ?? null,
  }
}

export function getPortfolioScenarios(
  portfolio: PortfolioOut,
  premiumOverride?: number
): PortfolioScenario[] {
  const premium = premiumOverride ?? portfolio.premiumEstimate ?? 0
  const basePremium = portfolio.premiumEstimate ?? premium
  const scale = basePremium > 0 ? premium / basePremium : 1
  const expectedPayout = (portfolio.expectedPayout ?? 0) * scale

  if (portfolio.scenarios && portfolio.scenarios.length > 0) {
    return portfolio.scenarios.map((s) => {
      const legs = s.legs ?? []
      const hitCount =
        s.hitCount ??
        (legs.length > 0 ? legs.filter((leg) => leg.hit).length : null)
      const totalCount =
        s.totalCount ?? (legs.length > 0 ? legs.length : portfolio.positions.length)
      const payout = s.payout * scale
      const netProfit = (s.netProfit != null ? s.netProfit * scale : payout - premium)
      return {
        ...s,
        hitCount,
        totalCount,
        payout,
        netProfit,
      }
    })
  }

  return [
    {
      label: '全部命中',
      hitCount: portfolio.positions.length,
      totalCount: portfolio.positions.length,
      payout: expectedPayout,
      netProfit: expectedPayout - premium,
    },
    {
      label: '部分命中 (~50%)',
      hitCount: Math.ceil(portfolio.positions.length / 2),
      totalCount: portfolio.positions.length,
      payout: expectedPayout * 0.5,
      netProfit: expectedPayout * 0.5 - premium,
    },
    {
      label: '未命中',
      hitCount: 0,
      totalCount: portfolio.positions.length,
      payout: 0,
      netProfit: -premium,
    },
  ]
}

export function scalePortfolioEconomics(
  portfolio: PortfolioOut,
  premium: number
): { maxPayout: number; fee: number; scale: number } {
  const basePremium = portfolio.premiumEstimate ?? premium
  const scale = basePremium > 0 ? premium / basePremium : 1
  const maxPayout = (portfolio.expectedPayout ?? 0) * scale
  return { maxPayout, fee: 0, scale }
}

export const DEFAULT_FEE_BPS = 200

export function estimateFee(premium: number, feeBps = DEFAULT_FEE_BPS): number {
  return (premium * feeBps) / 10_000
}

export function findSelectedPortfolio(
  portfolios: PortfolioOut[],
  selectedPortfolioId?: string | null
): PortfolioOut | undefined {
  if (!selectedPortfolioId) return undefined
  return portfolios.find((p) => p.id === selectedPortfolioId)
}

/** Net YES exposure in bps (−10000..+10000), treating YES as +weight and NO as −weight. */
export function computeNetExposureBps(positions: PositionOut[]): number {
  return positions.reduce((sum, p) => {
    const signed = p.side === 'YES' ? p.weight : -p.weight
    return sum + signed
  }, 0)
}

/**
 * Apply a new weight (bps) to one position and renormalize the rest so Σ=10000.
 * Returns null if the portfolio would become invalid.
 */
export function applyPositionWeight(
  positions: PositionOut[],
  positionId: string,
  nextWeightBps: number
): PositionOut[] | null {
  const clamped = Math.max(1, Math.min(9999, Math.round(nextWeightBps)))
  const target = positions.find((p) => p.id === positionId)
  if (!target || positions.length === 0) return null
  if (positions.length === 1) {
    return [{ ...target, weight: 10_000 }]
  }
  const others = positions.filter((p) => p.id !== positionId)
  const remaining = 10_000 - clamped
  if (remaining < others.length) return null
  const otherTotal = others.reduce((s, p) => s + p.weight, 0) || others.length
  let allocated = 0
  const scaledOthers = others.map((p, index) => {
    if (index === others.length - 1) {
      return { ...p, weight: remaining - allocated }
    }
    const w = Math.max(1, Math.round((p.weight / otherTotal) * remaining))
    allocated += w
    return { ...p, weight: w }
  })
  // Fix any rounding drift on the last other leg
  const drift =
    remaining - scaledOthers.reduce((s, p) => s + p.weight, 0)
  if (drift !== 0 && scaledOthers.length > 0) {
    const last = scaledOthers[scaledOthers.length - 1]
    scaledOthers[scaledOthers.length - 1] = {
      ...last,
      weight: Math.max(1, last.weight + drift),
    }
  }
  return positions.map((p) => {
    if (p.id === positionId) return { ...p, weight: clamped }
    return scaledOthers.find((o) => o.id === p.id) ?? p
  })
}

export function withCustomWeights(
  portfolio: PortfolioOut,
  positions: PositionOut[]
): PortfolioOut {
  return { ...portfolio, positions }
}
