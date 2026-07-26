import { useCallback, useMemo, useState } from 'react'

import type { PortfolioOut } from '@/features/policy/policyApi'

export function useMatrixSelection(portfolios: PortfolioOut[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [premiumOverrides, setPremiumOverrides] = useState<
    Record<string, number>
  >({})

  const setPremium = useCallback((portfolioId: string, premium: number) => {
    setPremiumOverrides((prev) => ({ ...prev, [portfolioId]: premium }))
  }, [])

  const selectedPortfolio = useMemo(
    () => portfolios.find((portfolio) => portfolio.id === selectedId),
    [portfolios, selectedId]
  )

  return {
    selectedId,
    setSelectedId,
    premiumOverrides,
    setPremium,
    selectedPortfolio,
  }
}
