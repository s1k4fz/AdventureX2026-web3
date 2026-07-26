import { useEffect } from 'react'
import { useWalletStore } from '@/stores/walletStore'

/**
 * Thin hook exposing wallet state + actions. Wraps zustand store so consumers
 * don't import the store directly (allows swapping implementation in M2).
 */
export function useWallet() {
  const address = useWalletStore((s) => s.address)
  const chainId = useWalletStore((s) => s.chainId)
  const status = useWalletStore((s) => s.status)
  const initialize = useWalletStore((s) => s.initialize)
  const connect = useWalletStore((s) => s.connect)
  const switchToInjectiveTestnet = useWalletStore(
    (s) => s.switchToInjectiveTestnet
  )
  const disconnect = useWalletStore((s) => s.disconnect)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return {
    address,
    chainId,
    status,
    isWalletConnected: Boolean(address),
    isConnected: status === 'connected',
    isChainReady: status === 'connected',
    isWrongNetwork: status === 'wrong-network',
    connect,
    switchToInjectiveTestnet,
    disconnect,
  }
}
