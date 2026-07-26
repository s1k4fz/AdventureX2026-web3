import { useCallback, useEffect, useState } from 'react'

import { erc20Abi } from '@/features/wallet/abi/erc20'
import { useWallet } from '@/features/wallet/useWallet'
import {
  getPublicClient,
  MOCK_USDC_ADDRESS,
} from '@/features/wallet/viemClients'

export function useWalletBalances(pollMs = 10_000) {
  const { address, isConnected } = useWallet()
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [injBalance, setInjBalance] = useState<bigint | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setUsdcBalance(null)
      setInjBalance(null)
      return
    }

    try {
      const client = getPublicClient()
      const [usdc, inj] = await Promise.all([
        client.readContract({
          address: MOCK_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        }) as Promise<bigint>,
        client.getBalance({ address: address as `0x${string}` }),
      ])
      setUsdcBalance(usdc)
      setInjBalance(inj)
      setUpdatedAt(Date.now())
    } catch {
      // non-critical
    }
  }, [address, isConnected])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    if (!isConnected || !address) {
      return () => window.clearTimeout(initialRefresh)
    }
    const interval = window.setInterval(() => void refresh(), pollMs)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
    }
  }, [address, isConnected, pollMs, refresh])

  return {
    usdcBalance,
    injBalance,
    updatedAt,
    refresh,
  }
}
