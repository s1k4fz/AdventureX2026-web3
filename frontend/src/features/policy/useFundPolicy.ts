import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import { useWalletStore } from '@/stores/walletStore'
import { useTxLockStore } from '@/features/wallet/txLockStore'
import {
  getPublicClient,
  getWalletClient,
  LEGACY_TX_OVERRIDES,
  POLICY_VAULT_ADDRESS,
  MOCK_USDC_ADDRESS,
} from '@/features/wallet/viemClients'
import { policyVaultAbi } from '@/features/wallet/abi/policyVault'
import { erc20Abi } from '@/features/wallet/abi/erc20'
import {
  agentTaskQueryKey,
  agentTasksListQueryKey,
  getAgentTaskByPolicy,
} from '@/features/agent/agentApi'
import {
  selectPortfolio,
  confirmOpen,
  getPolicy,
  policiesListQueryKey,
  policyQueryKey,
  type PolicyFundingPlan,
  type PolicyFundingPosition,
} from './policyApi'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FundingStep =
  | 'idle'
  | 'selecting'       // POST /select in progress
  | 'checking-balance'
  | 'minting'         // MockUSDC mint (test coin)
  | 'approving'       // USDC approve tx
  | 'funding'         // openPolicy tx
  | 'confirming'      // POST /confirm-open
  | 'success'
  | 'error'

export interface FundingState {
  step: FundingStep
  errorMessage: string | null
  /** Funding plan received from backend */
  fundingPlan: PolicyFundingPlan | null
  /** USDC approve tx hash (when approve was required) */
  approveTx: string | null
  /** openPolicy tx hash */
  openTx: string | null
}

/**
 * 出资状态机控制器：可由阶段层（OnChainActiveStage）创建后下发给
 * FundPolicyButton，使进度渲染收敛到单一入口。
 */
export type FundPolicyController = FundingState & {
  fund: (
    portfolioId: string,
    premium?: number,
    positionOverrides?: Array<{ marketRef: string; weightBps: number }>
  ) => Promise<void>
  reset: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 60

/** Format base-units string to display with 6 decimals (truncate, no rounding) */
export function formatUsdcBaseUnits(baseUnits: string | bigint): string {
  const val = typeof baseUnits === 'string' ? BigInt(baseUnits) : baseUnits
  const whole = val / 1_000_000n
  const frac = val % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0')
  // Trim trailing zeros for display
  const trimmed = fracStr.replace(/0+$/, '')
  return trimmed.length > 0 ? `${whole}.${trimmed}` : `${whole}`
}

/** Map backend positions to contract PositionInput tuples */
export function mapPositionsToContractInputs(
  positions: PolicyFundingPosition[]
): Array<{
  marketRef: `0x${string}`
  sideYes: boolean
  entryPriceBps: number
  weightBps: number
}> {
  return positions.map((p) => ({
    marketRef: p.marketRef,
    sideYes: p.sideYes,
    entryPriceBps: p.entryPriceBps,
    weightBps: p.weightBps,
  }))
}

/** Poll a condition until true, with max attempts */
async function pollUntil(
  fn: () => Promise<boolean>,
  intervalMs: number = POLL_INTERVAL_MS,
  maxAttempts: number = MAX_POLL_ATTEMPTS
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await fn()
    if (result) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

// ---------------------------------------------------------------------------
// Hook: useFundPolicy
// ---------------------------------------------------------------------------

export function useFundPolicy(policyId: string | undefined): FundPolicyController {
  const queryClient = useQueryClient()
  const [state, setState] = useState<FundingState>({
    step: 'idle',
    errorMessage: null,
    fundingPlan: null,
    approveTx: null,
    openTx: null,
  })

  const fund = useCallback(
    async (
      portfolioId: string,
      premium?: number,
      positionOverrides?: Array<{ marketRef: string; weightBps: number }>
    ) => {
      if (!policyId) return

      // ── Pre-checks ────────────────────────────────────────────────────────
      const walletState = useWalletStore.getState()
      if (walletState.status !== 'connected' || !walletState.address) {
        setState({
          step: 'error',
          errorMessage: '请先连接钱包',
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        return
      }
      if (walletState.chainId !== 1439) {
        setState({
          step: 'error',
          errorMessage: '请切换到 Injective 测试网',
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        return
      }

      // The policy can be opened in another task/browser tab between the page
      // render and this click. Read the lifecycle source of truth before
      // acquiring a transaction lock or calling /select again.
      let currentPolicy
      try {
        currentPolicy = await getPolicy(policyId)
      } catch {
        setState({
          step: 'error',
          errorMessage: '无法确认保障最新状态，请刷新后重试',
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        return
      }
      queryClient.setQueryData(policyQueryKey(policyId), currentPolicy)
      if (currentPolicy.status !== 'proposed') {
        setState({
          step: 'error',
          errorMessage:
            currentPolicy.status === 'active'
              ? '保障已在链上生效，无需重复出资'
              : `当前保障状态为「${currentPolicy.status}」，暂不能再次出资`,
          fundingPlan: null,
          approveTx: null,
          openTx: currentPolicy.openTx ?? null,
        })
        return
      }

      const txLock = useTxLockStore.getState()
      if (!txLock.acquire('出资中')) {
        setState({
          step: 'error',
          errorMessage: '有交易正在进行，请稍候',
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        return
      }

      const userAddress = walletState.address as `0x${string}`
      const publicClient = getPublicClient()
      const walletClient = getWalletClient()
      if (!walletClient) {
        useTxLockStore.getState().release()
        setState({
          step: 'error',
          errorMessage: '钱包连接异常',
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        return
      }

      let approveTx: string | null = null
      let openTx: string | null = null

      try {
        // ── Step 1: POST /select ──────────────────────────────────────────────
        setState({
          step: 'selecting',
          errorMessage: null,
          fundingPlan: null,
          approveTx: null,
          openTx: null,
        })
        const plan = await selectPortfolio({
          policyId,
          portfolioId,
          premium,
          positionOverrides,
        })
        setState((s) => ({ ...s, fundingPlan: plan }))

        const premiumBigInt = BigInt(plan.premiumBaseUnits)
        const maxPayoutBigInt = BigInt(plan.maxPayoutBaseUnits)
        const vaultAddr = plan.vaultAddress || POLICY_VAULT_ADDRESS
        const usdcAddr = plan.usdcAddress || MOCK_USDC_ADDRESS

        // ── Step 2: Pre-check vault free liquidity ────────────────────────────
        const freeLiq = await publicClient.readContract({
          address: vaultAddr,
          abi: policyVaultAbi,
          functionName: 'freeLiquidity',
        }) as bigint
        if (freeLiq < maxPayoutBigInt) {
          setState({
            step: 'error',
            errorMessage: '承保池流动性不足，暂无法出资',
            fundingPlan: plan,
            approveTx: null,
            openTx: null,
          })
          return
        }

        // ── Step 3: Check USDC balance ────────────────────────────────────────
        setState((s) => ({ ...s, step: 'checking-balance' }))
        const balance = await publicClient.readContract({
          address: usdcAddr,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [userAddress],
        }) as bigint

        if (balance < premiumBigInt) {
          // Mint test coins
          setState((s) => ({ ...s, step: 'minting' }))
          const mintAmount = premiumBigInt * 2n // mint 2x premium
          await walletClient.writeContract({
            account: userAddress,
            address: usdcAddr,
            abi: erc20Abi,
            functionName: 'mint',
            args: [userAddress, mintAmount],
            ...LEGACY_TX_OVERRIDES,
          })
          // Poll until balance increased
          const mintOk = await pollUntil(async () => {
            const newBal = await publicClient.readContract({
              address: usdcAddr,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [userAddress],
            }) as bigint
            return newBal >= premiumBigInt
          })
          if (!mintOk) {
            setState({
              step: 'error',
              errorMessage: '领取测试币超时，请重试',
              fundingPlan: plan,
              approveTx: null,
              openTx: null,
            })
            return
          }
        }

        // ── Step 4: Check & do USDC approve ───────────────────────────────────
        setState((s) => ({ ...s, step: 'approving' }))
        const allowance = await publicClient.readContract({
          address: usdcAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddress, vaultAddr],
        }) as bigint

        if (allowance < premiumBigInt) {
          approveTx = await walletClient.writeContract({
            account: userAddress,
            address: usdcAddr,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddr, premiumBigInt],
            ...LEGACY_TX_OVERRIDES,
          })
          setState((s) => ({ ...s, approveTx }))
          // Poll allowance until >= premium
          const approveOk = await pollUntil(async () => {
            const newAllowance = await publicClient.readContract({
              address: usdcAddr,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [userAddress, vaultAddr],
            }) as bigint
            return newAllowance >= premiumBigInt
          })
          if (!approveOk) {
            setState({
              step: 'error',
              errorMessage: '授权确认超时，请重试',
              fundingPlan: plan,
              approveTx,
              openTx: null,
            })
            return
          }
        }

        // ── Step 5: openPolicy ────────────────────────────────────────────────
        setState((s) => ({ ...s, step: 'funding' }))
        const positionInputs = mapPositionsToContractInputs(plan.positions)
        openTx = await walletClient.writeContract({
          account: userAddress,
          address: vaultAddr,
          abi: policyVaultAbi,
          functionName: 'openPolicy',
          args: [
            plan.onChainPolicyId,
            positionInputs,
            premiumBigInt,
            BigInt(plan.coverageEnd),
          ],
          ...LEGACY_TX_OVERRIDES,
        })
        setState((s) => ({ ...s, openTx }))

        // Poll on-chain: policies(onChainPolicyId).user != zero
        const openOk = await pollUntil(async () => {
          const result = await publicClient.readContract({
            address: vaultAddr,
            abi: policyVaultAbi,
            functionName: 'policies',
            args: [plan.onChainPolicyId],
          }) as [string, bigint, bigint, bigint, boolean]
          return result[0] !== ZERO_ADDRESS
        })
        if (!openOk) {
          setState({
            step: 'error',
            errorMessage: '出资确认超时，请检查交易状态',
            fundingPlan: plan,
            approveTx,
            openTx,
          })
          return
        }

        // ── Step 6: POST /confirm-open ────────────────────────────────────────
        setState((s) => ({ ...s, step: 'confirming' }))
        const updatedPolicy = await confirmOpen({
          policyId,
          onChainPolicyId: plan.onChainPolicyId,
          openTx,
        })
        queryClient.setQueryData(policyQueryKey(policyId), updatedPolicy)
        // The dashboard/schedule and Agent workspace use different query
        // projections. Refresh both in parallel so confirmation immediately
        // promotes the policy and switches the workspace into monitoring.
        const agentTaskPromise = getAgentTaskByPolicy(policyId).catch(() => null)
        const policyListRefresh = queryClient.invalidateQueries({
          queryKey: policiesListQueryKey(),
        })
        const agentTask = await agentTaskPromise
        if (agentTask) {
          queryClient.setQueryData(agentTaskQueryKey(agentTask.id), agentTask)
          await queryClient.invalidateQueries({
            queryKey: agentTasksListQueryKey(),
          })
        }
        await queryClient.invalidateQueries({
          queryKey: policyQueryKey(policyId),
        })
        await policyListRefresh

        setState({
          step: 'success',
          errorMessage: null,
          fundingPlan: plan,
          approveTx,
          openTx,
        })
      } catch (err: unknown) {
        console.error('[useFundPolicy] error:', err)
        let msg =
          err instanceof Error && err.message.includes('User rejected')
            ? '用户取消了交易'
            : '出资失败，请重试'
        if (
          isAxiosError(err) &&
          err.response?.status === 409 &&
          err.response.data?.detail === 'policy_status_not_proposed'
        ) {
          try {
            const currentPolicy = await getPolicy(policyId)
            queryClient.setQueryData(policyQueryKey(policyId), currentPolicy)
            msg =
              currentPolicy.status === 'active'
                ? '保障已在链上生效，无需重复出资'
                : `当前保障状态为「${currentPolicy.status}」，请刷新后继续`
          } catch {
            msg = '保障状态已变化，请刷新页面后继续'
          }
        }
        setState((s) => ({
          ...s,
          step: 'error',
          errorMessage: msg,
          approveTx: s.approveTx ?? approveTx,
          openTx: s.openTx ?? openTx,
        }))
      } finally {
        useTxLockStore.getState().release()
      }
    },
    [policyId, queryClient]
  )

  const reset = useCallback(() => {
    setState({
      step: 'idle',
      errorMessage: null,
      fundingPlan: null,
      approveTx: null,
      openTx: null,
    })
  }, [])

  return { ...state, fund, reset }
}
