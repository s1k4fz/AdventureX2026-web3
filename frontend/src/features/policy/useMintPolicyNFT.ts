import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import { policyNftAbi } from '@/features/wallet/abi/policyNft'
import { useTxLockStore } from '@/features/wallet/txLockStore'
import {
  getPublicClient,
  getWalletClient,
  LEGACY_TX_OVERRIDES,
  POLICY_NFT_ADDRESS,
} from '@/features/wallet/viemClients'
import { useWalletStore } from '@/stores/walletStore'
import {
  confirmPolicyNFTMint,
  getPolicy,
  policiesListQueryKey,
  policyNFTMetadataQueryKey,
  policyQueryKey,
} from './policyApi'
import { onChainPolicyIdToTokenId } from './policyNftUtils'

export type PolicyNFTMintStep =
  | 'idle'
  | 'checking'
  | 'minting'
  | 'confirming'
  | 'success'
  | 'error'

interface PolicyNFTMintState {
  step: PolicyNFTMintStep
  errorMessage: string | null
  mintTx: string | null
  tokenId: string | null
  recoveredFromChain: boolean
}

const INITIAL_STATE: PolicyNFTMintState = {
  step: 'idle',
  errorMessage: null,
  mintTx: null,
  tokenId: null,
  recoveredFromChain: false,
}

const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 60

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const extra = error as Error & {
    shortMessage?: string
    details?: string
    code?: number
  }
  return [extra.message, extra.shortMessage, extra.details]
    .filter(Boolean)
    .join(' ')
}

function isOwnerOfMissingToken(error: unknown): boolean {
  const text = errorText(error)
  // PolicyNFT.ownerOf has only one revert path. Some Injective gateways strip
  // the reason and return the generic execution-reverted form.
  return /nonexistent token|execution reverted/i.test(text)
}

function isAlreadyMinted(error: unknown): boolean {
  return /already minted/i.test(errorText(error))
}

function isUserRejected(error: unknown): boolean {
  const maybeCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: number }).code
      : undefined
  return maybeCode === 4001 || /user rejected|user denied/i.test(errorText(error))
}

function friendlyMintError(error: unknown): string {
  if (isUserRejected(error)) return '你取消了 NFT 铸造交易'
  if (/insufficient funds/i.test(errorText(error))) {
    return 'INJ 余额不足，无法支付铸造 Gas'
  }
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (
      detail === 'policy_status_not_mintable' ||
      detail === 'policy_not_nft_eligible'
    ) {
      return '仅生效或已结算的保单可以铸造 NFT'
    }
    if (
      detail === 'nft_not_confirmed_on_chain' ||
      detail === 'policy_nft_not_confirmed'
    ) {
      return '链上 NFT 尚未确认，请稍后重试同步'
    }
    if (detail === 'policy_nft_not_configured') {
      return '后端尚未配置 PolicyNFT 合约，暂不能同步'
    }
    if (detail === 'policy_nft_chain_unavailable') {
      return '后端暂时无法读取 Injective 链，请稍后重试同步'
    }
  }
  return '铸造未完成，请稍后重试；已上链的 NFT 会自动恢复同步'
}

/**
 * Mint a deterministic PolicyNFT and persist it through the authenticated API.
 *
 * Confirmation deliberately polls ownerOf instead of waiting for a receipt:
 * Injective's RPC load balancer can return a stale/null receipt even after the
 * state transition is visible. The same state-based pattern is used by policy
 * funding elsewhere in the app.
 */
export function useMintPolicyNFT(policyId: string | undefined) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<PolicyNFTMintState>(INITIAL_STATE)
  /** Sync re-entry guard — covers the gap before React re-renders disabled CTA. */
  const inFlightRef = useRef(false)

  const mint = useCallback(async () => {
    if (!policyId || inFlightRef.current) return
    inFlightRef.current = true

    let lockHeld = false
    let mintTx: `0x${string}` | null = null
    let recoveredFromChain = false
    let tokenId: string | null = null

    try {
      const walletState = useWalletStore.getState()
      if (walletState.status !== 'connected' || !walletState.address) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '请先连接钱包',
        })
        return
      }
      if (walletState.chainId !== 1439) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '请切换到 Injective 测试网',
        })
        return
      }
      const policyNftAddress = POLICY_NFT_ADDRESS
      if (!policyNftAddress) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: 'PolicyNFT 合约尚未配置，暂不能铸造',
        })
        return
      }

      // Take the global tx lock before any await so a second click cannot race
      // past getPolicy and submit a duplicate mint.
      if (!useTxLockStore.getState().acquire('铸造保单 NFT')) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '有交易正在进行，请稍候',
        })
        return
      }
      lockHeld = true

      setState({
        step: 'checking',
        errorMessage: null,
        mintTx: null,
        tokenId: null,
        recoveredFromChain: false,
      })

      let currentPolicy
      try {
        currentPolicy = await getPolicy(policyId)
        queryClient.setQueryData(policyQueryKey(policyId), currentPolicy)
      } catch {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '无法确认保单最新状态，请刷新后重试',
        })
        return
      }

      if (!['active', 'settled'].includes(currentPolicy.status)) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '仅生效或已结算的保单可以铸造 NFT',
        })
        return
      }
      if (!currentPolicy.onChainPolicyId) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '保单缺少链上 ID，无法铸造',
        })
        return
      }

      tokenId = onChainPolicyIdToTokenId(currentPolicy.onChainPolicyId)
      if (!tokenId) {
        setState({
          ...INITIAL_STATE,
          step: 'error',
          errorMessage: '保单链上 ID 格式无效，无法铸造',
        })
        return
      }
      if (currentPolicy.nftTokenId) {
        setState({
          step: 'success',
          errorMessage: null,
          mintTx: currentPolicy.nftMintTx,
          tokenId: currentPolicy.nftTokenId,
          recoveredFromChain: false,
        })
        return
      }

      const userAddress = walletState.address as `0x${string}`
      const onChainPolicyId = currentPolicy.onChainPolicyId as `0x${string}`
      const publicClient = getPublicClient()
      const walletClient = getWalletClient()
      if (!walletClient) {
        throw new Error('wallet client unavailable')
      }

      setState((previous) => ({ ...previous, tokenId }))

      const readOwner = async (): Promise<`0x${string}` | null> => {
        try {
          return (await publicClient.readContract({
            address: policyNftAddress,
            abi: policyNftAbi,
            functionName: 'ownerOf',
            args: [BigInt(tokenId!)],
          })) as `0x${string}`
        } catch (error) {
          if (isOwnerOfMissingToken(error)) return null
          throw error
        }
      }

      const confirm = async (txHash?: string) => {
        setState((previous) => ({
          ...previous,
          step: 'confirming',
          mintTx: txHash ?? previous.mintTx,
          tokenId,
          recoveredFromChain,
        }))
        const updatedPolicy = await confirmPolicyNFTMint({
          policyId,
          nftTokenId: tokenId!,
          mintTx: txHash,
        })
        queryClient.setQueryData(policyQueryKey(policyId), updatedPolicy)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: policiesListQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: policyNFTMetadataQueryKey(tokenId!),
          }),
        ])
        setState({
          step: 'success',
          errorMessage: null,
          mintTx: updatedPolicy.nftMintTx ?? txHash ?? null,
          tokenId: updatedPolicy.nftTokenId ?? tokenId,
          recoveredFromChain,
        })
      }

      const bytecode = await publicClient.getCode({
        address: policyNftAddress,
      })
      if (!bytecode || bytecode === '0x') {
        throw new Error('configured PolicyNFT address has no bytecode')
      }

      const existingOwner = await readOwner()
      if (existingOwner) {
        recoveredFromChain = true
        await confirm()
        return
      }

      setState((previous) => ({ ...previous, step: 'minting' }))
      try {
        mintTx = await walletClient.writeContract({
          account: userAddress,
          address: policyNftAddress,
          abi: policyNftAbi,
          functionName: 'mint',
          args: [onChainPolicyId],
          ...LEGACY_TX_OVERRIDES,
        })
        setState((previous) => ({ ...previous, mintTx }))
      } catch (error) {
        // Another tab may have minted after our pre-read. Recover from chain
        // instead of asking the user to sign a doomed duplicate transaction.
        if (!isAlreadyMinted(error) || !(await readOwner())) {
          throw error
        }
        recoveredFromChain = true
      }

      let confirmedOwner: `0x${string}` | null = null
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        try {
          confirmedOwner = await readOwner()
        } catch {
          // A single Injective RPC gateway can lag behind its peers. Continue
          // bounded polling; do not turn a transient read into a second write.
        }
        if (confirmedOwner) break
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      if (!confirmedOwner) {
        throw new Error('ownerOf confirmation timed out')
      }
      if (
        mintTx &&
        confirmedOwner.toLowerCase() !== userAddress.toLowerCase()
      ) {
        throw new Error('minted token owner mismatch')
      }

      await confirm(mintTx ?? undefined)
    } catch (error) {
      console.error('[useMintPolicyNFT] error:', error)
      setState((previous) => ({
        ...previous,
        step: 'error',
        errorMessage: friendlyMintError(error),
        mintTx: previous.mintTx ?? mintTx,
        tokenId: previous.tokenId ?? tokenId,
        recoveredFromChain,
      }))
    } finally {
      if (lockHeld) useTxLockStore.getState().release()
      inFlightRef.current = false
    }
  }, [policyId, queryClient])

  const reset = useCallback(() => {
    if (inFlightRef.current) return
    setState(INITIAL_STATE)
  }, [])

  return { ...state, mint, reset }
}
