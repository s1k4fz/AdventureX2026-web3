import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Gem } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { useWallet } from '@/features/wallet/useWallet'
import { useTxLockStore } from '@/features/wallet/txLockStore'
import {
  getPublicClient,
  MOCK_USDC_ADDRESS,
  POLICY_VAULT_ADDRESS,
} from '@/features/wallet/viemClients'
import { policyVaultAbi } from '@/features/wallet/abi/policyVault'
import { erc20Abi } from '@/features/wallet/abi/erc20'
import type { PortfolioOut } from './policyApi'
import {
  estimateFee,
  formatUsd,
  getPortfolioScenarios,
  scalePortfolioEconomics,
} from './portfolioUtils'
import {
  MIN_PREMIUM_USDC,
  PREMIUM_PRESETS,
} from './policyStatus'
import { useFundPolicy, formatUsdcBaseUnits } from './useFundPolicy'
import type { FundingStep, FundPolicyController } from './useFundPolicy'
import { FundingChainSteps } from './OnChainActivity'
import { TxLink } from '@/features/wallet/TxLink'

const STEP_LABELS: Record<FundingStep, string> = {
  idle: '确认出资',
  selecting: '准备出资方案…',
  'checking-balance': '检查余额…',
  minting: '领取测试币…',
  approving: '授权中…',
  funding: '出资中…',
  confirming: '确认中…',
  success: '出资成功',
  error: '出资失败，请重试',
}

interface FundPolicyButtonProps {
  policyId: string
  portfolioId: string
  portfolio: PortfolioOut
  isProposed: boolean
  positionOverrides?: Array<{ marketRef: string; weightBps: number }>
  /**
   * 阶段层下发的共享出资状态机（单一进度入口）；
   * 未提供时回退为按钮自持状态（保单详情页路径）。
   */
  controller?: FundPolicyController
  /** 为 true 时不在按钮下方内联渲染链上进度（由阶段层统一渲染）。 */
  hideInlineSteps?: boolean
}

export function FundPolicyButton({
  policyId,
  portfolioId,
  portfolio,
  isProposed,
  positionOverrides,
  controller,
  hideInlineSteps = false,
}: FundPolicyButtonProps) {
  const { status, isConnected, isWrongNetwork, connect, switchToInjectiveTestnet, address } =
    useWallet()
  const isTxInFlight = useTxLockStore((s) => s.isTxInFlight)
  const ownFunding = useFundPolicy(controller ? undefined : policyId)
  const { step, errorMessage, fundingPlan, fund, reset, approveTx, openTx } =
    controller ?? ownFunding

  const defaultPremium = portfolio.premiumEstimate ?? 100
  const [sheetOpen, setSheetOpen] = useState(false)
  const [premium, setPremium] = useState(defaultPremium)
  const [customInput, setCustomInput] = useState('')
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [freeLiquidity, setFreeLiquidity] = useState<bigint | null>(null)
  const [feeBps, setFeeBps] = useState(200)

  useEffect(() => {
    if (!isConnected || !address) {
      setUsdcBalance(null)
      return
    }
    let cancelled = false
    const readBalance = async () => {
      try {
        const client = getPublicClient()
        const [bal, liq, fee] = await Promise.all([
          client.readContract({
            address: MOCK_USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address as `0x${string}`],
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
        if (!cancelled) {
          setUsdcBalance(bal)
          setFreeLiquidity(liq)
          setFeeBps(fee)
        }
      } catch {
        // non-critical
      }
    }
    void readBalance()
    const interval = setInterval(readBalance, 10_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isConnected, address, step, sheetOpen])

  const economics = useMemo(
    () => scalePortfolioEconomics(portfolio, premium),
    [portfolio, premium]
  )
  const fee = estimateFee(premium, feeBps)
  const scenarios = getPortfolioScenarios(portfolio, premium)
  const fullHit = scenarios[0]

  const premiumBase = BigInt(Math.round(premium * 1e6))
  const maxPayoutBase = BigInt(Math.round(economics.maxPayout * 1e6))

  const validationError = useMemo(() => {
    if (premium < MIN_PREMIUM_USDC) {
      return `最小保费 ${MIN_PREMIUM_USDC} USDC`
    }
    if (usdcBalance != null && usdcBalance < premiumBase) {
      return 'USDC 余额不足（可自动领取测试币）'
    }
    if (freeLiquidity != null && freeLiquidity < maxPayoutBase) {
      return '承保池流动性不足以覆盖最大赔付'
    }
    return null
  }, [premium, usdcBalance, freeLiquidity, premiumBase, maxPayoutBase])

  if (!isProposed) return null

  if (step === 'success' && fundingPlan) {
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3">
        <p className="text-[13px] font-medium text-emerald-300">✓ 出资成功</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span>保费 {formatUsdcBaseUnits(fundingPlan.premiumBaseUnits)} USDC</span>
          <span>最大赔付 {formatUsdcBaseUnits(fundingPlan.maxPayoutBaseUnits)} USDC</span>
          {fundingPlan.coverageEnd > 0 && (
            <span>
              结算时间{' '}
              {new Date(fundingPlan.coverageEnd * 1000).toLocaleDateString('zh-CN')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          {approveTx && (
            <span className="text-muted-foreground">
              授权 <TxLink hash={approveTx} />
            </span>
          )}
          {openTx && (
            <span className="text-muted-foreground">
              开保 <TxLink hash={openTx} />
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          下一步：将保单铸造成链上 NFT 凭证。
        </p>
        <Button asChild size="sm" className="h-9 w-full gap-1.5 rounded-lg text-[13px]">
          <Link to={`/policy/${policyId}?tab=nft`}>
            <Gem className="size-3.5" />
            铸造保单 NFT
          </Link>
        </Button>
      </div>
    )
  }

  const handleOpenSheet = () => {
    if (status === 'disconnected' || status === 'connecting') {
      void connect()
      return
    }
    if (isWrongNetwork) {
      void switchToInjectiveTestnet()
      return
    }
    setPremium(defaultPremium)
    setCustomInput('')
    setSheetOpen(true)
  }

  const handleConfirmFund = () => {
    if (validationError && usdcBalance != null && usdcBalance >= premiumBase) {
      if (premium < MIN_PREMIUM_USDC) return
    }
    setSheetOpen(false)
    if (step === 'error') reset()
    void fund(portfolioId, premium, positionOverrides)
  }

  const isInProgress = step !== 'idle' && step !== 'error' && step !== 'success'
  const ctaLabel =
    status === 'disconnected' || status === 'connecting'
      ? '连接钱包'
      : isWrongNetwork
        ? '切换网络'
        : isInProgress
          ? STEP_LABELS[step]
          : step === 'success'
            ? STEP_LABELS.success
            : isProposed
              ? '确认出资'
              : '选择该方案并出资'

  return (
    <>
      <Button
        type="button"
        className="mt-3 w-full rounded-lg bg-primary text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={isTxInFlight || isInProgress}
        onClick={handleOpenSheet}
      >
        {isInProgress && <Spinner className="mr-1.5 size-3.5" />}
        {ctaLabel}
      </Button>

      {!hideInlineSteps && isInProgress && (
        <FundingChainSteps
          step={step}
          approveTx={approveTx}
          openTx={openTx}
          onChainPolicyId={fundingPlan?.onChainPolicyId}
        />
      )}

      {!hideInlineSteps && step === 'error' && (
        <FundingChainSteps
          step={step}
          approveTx={approveTx}
          openTx={openTx}
          onChainPolicyId={fundingPlan?.onChainPolicyId}
          errorMessage={errorMessage}
        />
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>设置出资额度</SheetTitle>
            <SheetDescription>
              调整保费后，最大赔付与各头寸份额将按比例联动重算。
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4">
            <div className="flex flex-wrap gap-2">
              {PREMIUM_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={premium === preset ? 'default' : 'outline'}
                  onClick={() => {
                    setPremium(preset)
                    setCustomInput('')
                  }}
                >
                  ${preset}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="premium-slider">保费 (USDC)</Label>
                <span className="font-mono text-sm font-semibold text-primary">
                  ${premium.toLocaleString()}
                </span>
              </div>
              <input
                id="premium-slider"
                type="range"
                min={MIN_PREMIUM_USDC}
                max={2000}
                step={10}
                value={premium}
                onChange={(e) => {
                  setPremium(Number(e.target.value))
                  setCustomInput('')
                }}
                className="w-full accent-primary"
              />
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={MIN_PREMIUM_USDC}
                  placeholder="自定义金额"
                  value={customInput}
                  onChange={(e) => {
                    setCustomInput(e.target.value)
                    const val = parseFloat(e.target.value)
                    if (!Number.isNaN(val) && val >= MIN_PREMIUM_USDC) {
                      setPremium(val)
                    }
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">最大赔付</span>
                <span className="font-medium text-primary">
                  {formatUsd(economics.maxPayout)}
                </span>
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-muted-foreground">
                  手续费 ({(feeBps / 100).toFixed(2)}%)
                </span>
                <span className="text-foreground">{formatUsd(fee)}</span>
              </div>
              {fullHit && (
                <div className="mt-1.5 flex justify-between">
                  <span className="text-muted-foreground">全部命中净收益</span>
                  <span className="text-emerald-400">
                    +{formatUsd(fullHit.netProfit)}
                  </span>
                </div>
              )}
            </div>

            {isConnected && usdcBalance != null && (
              <p className="text-[12px] text-muted-foreground">
                钱包余额：{formatUsdcBaseUnits(usdcBalance)} USDC
              </p>
            )}

            {validationError && (
              <p className="text-[12px] text-amber-400">{validationError}</p>
            )}
          </div>

          <SheetFooter>
            <Button
              type="button"
              className="w-full"
              disabled={
                premium < MIN_PREMIUM_USDC ||
                (freeLiquidity != null && freeLiquidity < maxPayoutBase)
              }
              onClick={handleConfirmFund}
            >
              确认出资 ${premium.toLocaleString()}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
