import { useCallback, useEffect, useState } from 'react'

import { policyVaultAbi } from '@/features/wallet/abi/policyVault'
import {
  getPublicClient,
  POLICY_VAULT_ADDRESS,
} from '@/features/wallet/viemClients'

export interface PoolStats {
  reserved: bigint
  freeLiquidity: bigint
  feeBps: number
}

export function usePoolStats(pollMs = 15_000) {
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const client = getPublicClient()
      const [reserved, freeLiquidity, feeBps] = await Promise.all([
        client.readContract({
          address: POLICY_VAULT_ADDRESS,
          abi: policyVaultAbi,
          functionName: 'reserved',
        }) as Promise<bigint>,
        client.readContract({
          address: POLICY_VAULT_ADDRESS,
          abi: policyVaultAbi,
          functionName: 'freeLiquidity',
        }) as Promise<bigint>,
        client.readContract({
          address: POLICY_VAULT_ADDRESS,
          abi: policyVaultAbi,
          functionName: 'feeBps',
        }) as Promise<number>,
      ])

      setStats({ reserved, freeLiquidity, feeBps })
      setError(null)
      setUpdatedAt(Date.now())
    } catch (err) {
      console.error('Pool read error', err)
      setError('读取承保池数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(interval)
  }, [pollMs, refresh])

  const totalPool = stats ? stats.reserved + stats.freeLiquidity : 0n
  const utilizationPct =
    stats && totalPool > 0n
      ? Number((stats.reserved * 10000n) / totalPool) / 100
      : 0

  return {
    stats,
    totalPool,
    utilizationPct,
    error,
    loading,
    updatedAt,
    refresh,
  }
}
