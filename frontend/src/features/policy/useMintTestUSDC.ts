import { useState, useCallback } from 'react'

import { useWalletStore } from '@/stores/walletStore'
import { useTxLockStore } from '@/features/wallet/txLockStore'
import {
  getPublicClient,
  getWalletClient,
  LEGACY_TX_OVERRIDES,
  MOCK_USDC_ADDRESS,
} from '@/features/wallet/viemClients'
import { erc20Abi } from '@/features/wallet/abi/erc20'

// ---------------------------------------------------------------------------
// Hook: useMintTestUSDC
// ---------------------------------------------------------------------------

export type MintStep = 'idle' | 'minting' | 'success' | 'error'

export function useMintTestUSDC() {
  const [step, setStep] = useState<MintStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mint = useCallback(async (amount: bigint) => {
    const walletState = useWalletStore.getState()
    if (walletState.status !== 'connected' || !walletState.address) {
      setStep('error')
      setErrorMessage('请先连接钱包')
      return
    }
    if (walletState.chainId !== 1439) {
      setStep('error')
      setErrorMessage('请切换到 Injective 测试网')
      return
    }

    const txLock = useTxLockStore.getState()
    if (!txLock.acquire('领取测试币')) {
      setStep('error')
      setErrorMessage('有交易正在进行，请稍候')
      return
    }

    const userAddress = walletState.address as `0x${string}`
    const publicClient = getPublicClient()
    const walletClient = getWalletClient()
    if (!walletClient) {
      useTxLockStore.getState().release()
      setStep('error')
      setErrorMessage('钱包连接异常')
      return
    }

    try {
      setStep('minting')
      setErrorMessage(null)

      // Get balance before
      const balBefore = (await publicClient.readContract({
        address: MOCK_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress],
      })) as bigint

      await walletClient.writeContract({
        account: userAddress,
        address: MOCK_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'mint',
        args: [userAddress, amount],
        ...LEGACY_TX_OVERRIDES,
      })

      // Poll until balance increases
      const POLL_INTERVAL = 2000
      const MAX_ATTEMPTS = 30
      let confirmed = false
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const newBal = (await publicClient.readContract({
          address: MOCK_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [userAddress],
        })) as bigint
        if (newBal > balBefore) {
          confirmed = true
          break
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      }

      if (!confirmed) {
        setStep('error')
        setErrorMessage('领取测试币超时，请重试')
      } else {
        setStep('success')
      }
    } catch (err: unknown) {
      console.error('[useMintTestUSDC] error:', err)
      const msg =
        err instanceof Error && err.message.includes('User rejected')
          ? '用户取消了交易'
          : '领取测试币失败，请重试'
      setStep('error')
      setErrorMessage(msg)
    } finally {
      useTxLockStore.getState().release()
    }
  }, [])

  const reset = useCallback(() => {
    setStep('idle')
    setErrorMessage(null)
  }, [])

  return { step, errorMessage, mint, reset }
}
