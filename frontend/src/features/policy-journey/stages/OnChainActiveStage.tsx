import { useNavigate } from 'react-router-dom'
import { Gem, WalletCards } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { WalletConnectButton } from '@/features/wallet/WalletConnectButton'
import { useWallet } from '@/features/wallet/useWallet'
import type { AgentTaskStatus } from '@/features/agent/types'
import { canProceedToFunding, canRetry } from '@/features/agent/taskCapabilities'
import { PolicyCommandRetry } from '@/features/agent/artifacts/PolicyCommandRetry'
import { FundingChainSteps } from '@/features/policy/OnChainActivity'
import { useFundPolicy } from '@/features/policy/useFundPolicy'
import { PolicyNFTPanel } from '@/features/policy/PolicyNFTPanel'
import {
  usePolicyQuery,
  type PortfolioOut,
} from '@/features/policy/policyApi'

import { ComparisonMatrix } from '../components/ComparisonMatrix'
import { TIER_LABELS } from '../components/matrixColumns'
import { PreflightChecklist } from '../components/PreflightChecklist'
import { StageShell } from '../components/StageShell'
import type { StageStatus } from '../types'

const secondaryActionButtonClassName =
  'h-9 shrink-0 gap-1.5 rounded-full border-[var(--units-stroke-color)] px-3.5 text-[13px] shadow-none'

export interface OnChainActiveStageProps {
  title: string
  taskStatus?: AgentTaskStatus
  taskId?: string
  policyId?: string | null
  portfolios?: PortfolioOut[]
  selectedPortfolioId?: string | null
  stageStatus?: StageStatus
  errorMessage?: string | null
  onEnterPolicy?: () => void
}

export function OnChainActiveStage({
  title,
  taskStatus,
  taskId,
  policyId,
  portfolios = [],
  selectedPortfolioId,
  stageStatus,
  errorMessage,
  onEnterPolicy,
}: OnChainActiveStageProps) {
  const navigate = useNavigate()
  const wallet = useWallet()
  const policyQuery = usePolicyQuery(policyId ?? undefined, {
    pollSettled: true,
  })
  const policy = policyQuery.data
  // 出资状态机上提到阶段层：预览态与真实进度共用同一个渲染入口，
  // FundPolicyButton 只负责触发（消除「预览卡 + 按钮内进度」两套 UI）。
  const funding = useFundPolicy(policyId ?? undefined)

  const goToPolicy = (tab?: 'nft') => {
    if (!tab && onEnterPolicy) {
      onEnterPolicy()
      return
    }
    if (policyId) {
      navigate(tab ? `/policy/${policyId}?tab=${tab}` : `/policy/${policyId}`)
    }
  }

  if (taskStatus && canRetry(taskStatus)) {
    return (
      <StageShell
        stage="on_chain_active"
        hideKicker
        title="任务失败"
        description={errorMessage ?? '保障方案生成失败，可重试编排。'}
      >
        {taskId ? <PolicyCommandRetry taskId={taskId} /> : null}
      </StageShell>
    )
  }

  if (taskStatus === 'cancelled') {
    return (
      <StageShell
        stage="on_chain_active"
        hideKicker
        title="任务已取消"
        description="此任务不会继续执行。你可以返回看板，或新建一个任务继续规划。"
      />
    )
  }

  if (taskStatus === 'succeeded') {
    return (
      <StageShell
        stage="on_chain_active"
        hideKicker
        title="任务已完成"
        description="保障流程已结束，不能再修改任务。可打开保单详情查看保障状态。"
      >
        {policyId ? (
          <Button
            type="button"
            variant="outline"
            className={`${secondaryActionButtonClassName} self-start`}
            onClick={() => goToPolicy()}
          >
            <WalletCards className="size-4" />
            打开保单详情
          </Button>
        ) : null}
      </StageShell>
    )
  }

  const canFund = canProceedToFunding(taskStatus ?? 'monitoring')
  const selectedPortfolio = selectedPortfolioId
    ? portfolios.find((p) => p.id === selectedPortfolioId) ?? null
    : null
  const tierLabel = selectedPortfolio
    ? TIER_LABELS[selectedPortfolio.tier]
    : null
  // Edge case: the locked tier id can be missing (SSE lag / stale snapshot).
  // Never guess an arbitrary tier — surface every fundable option instead.
  const displayPortfolios = selectedPortfolio ? [selectedPortfolio] : portfolios
  const tierUnresolved = !selectedPortfolio && portfolios.length > 1
  // Edge case: policy funded from another tab/task before this canvas caught
  // up — treat it as active so the funding CTA can't double-fire.
  const policyAlreadyOpen =
    policy?.status === 'active' || policy?.status === 'settled'
  const isActive =
    stageStatus === 'success' ||
    taskStatus === 'monitoring' ||
    policyAlreadyOpen
  const fundingEnabled = canFund && !isActive
  const canMintNft =
    isActive &&
    Boolean(policy) &&
    (policy?.status === 'active' || policy?.status === 'settled')
  const nftMinted = Boolean(policy?.nftTokenId)

  const checks = [
    {
      id: 'wallet',
      ok: wallet.isConnected,
      label: wallet.isConnected ? '钱包已连接' : '请先连接钱包',
      action: wallet.isConnected ? null : (
        <WalletConnectButton className="h-8 shrink-0 px-3 text-[12.5px]" />
      ),
    },
    {
      id: 'network',
      ok: !wallet.isWrongNetwork,
      label: wallet.isWrongNetwork ? '请切换到 Injective 测试网' : '网络就绪',
      action: wallet.isWrongNetwork ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-full border-[var(--units-stroke-color)] px-3 text-[12.5px] shadow-none"
          onClick={() => void wallet.switchToInjectiveTestnet()}
        >
          切换网络
        </Button>
      ) : null,
    },
    {
      id: 'policy',
      ok: Boolean(policyId),
      label: policyId
        ? '保单已就绪'
        : '缺少保单引用，请刷新页面或稍候任务同步',
      action: null,
    },
  ]
  const blockingCheck = checks.find((check) => !check.ok)

  return (
    <StageShell
      stage="on_chain_active"
      measure="board"
      title={
        isActive
          ? nftMinted
            ? '保障已生效'
            : '保障已生效 · 可铸造 NFT'
          : fundingEnabled
            ? '出资前确认'
            : '链上生效'
      }
      description={
        isActive
          ? nftMinted
            ? title
            : '开保已确认。下一步可将保单铸造成链上 NFT 凭证；铸造不改变保障与结算规则。'
          : fundingEnabled
            ? tierLabel
              ? `已锁定「${tierLabel}」档位。按下方进度完成钱包连接、授权与开保；链上确认后即可铸造保单 NFT。`
              : tierUnresolved
                ? '暂未同步到已锁定的档位，下方展示全部方案；请在你选定的档位上完成出资。'
                : '档位已锁定。按下方进度完成钱包连接、授权与开保；链上确认后即可铸造保单 NFT。'
            : '此阶段已结束。可打开保单详情查看保障与监控状态。'
      }
      aside={
        isActive ? (
          <span className="rounded-full border border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--units-green)]">
            {nftMinted ? '监控中 · NFT 已铸造' : '监控中'}
          </span>
        ) : fundingEnabled ? (
          <span className="rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--units-orange)]">
            {tierLabel ? `已锁定 ${tierLabel} · 待出资` : '等待出资确认'}
          </span>
        ) : null
      }
      footer={
        fundingEnabled || policyId ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[13px] text-muted-foreground">
              {fundingEnabled
                ? (blockingCheck?.label ?? '检查已通过，可在钱包中完成授权与开保')
                : nftMinted
                  ? '保障已在链上生效，NFT 凭证可分享'
                  : '保障已在链上生效；可在此铸造 NFT，或打开详情查看监控'}
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {fundingEnabled ? (
                <WalletConnectButton className="h-9 rounded-full border border-[var(--units-stroke-color)] px-3.5 text-[13px]" />
              ) : null}
              {canMintNft && !nftMinted ? (
                <Button
                  type="button"
                  className="h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-[13px]"
                  onClick={() => goToPolicy('nft')}
                >
                  <Gem className="size-4" />
                  打开 NFT 详情
                </Button>
              ) : null}
              {policyId ? (
                <Button
                  type="button"
                  variant="outline"
                  className={secondaryActionButtonClassName}
                  onClick={() => goToPolicy()}
                >
                  <WalletCards className="size-4" />
                  查看保单详情
                </Button>
              ) : null}
            </div>
          </div>
        ) : null
      }
    >
      {fundingEnabled ? (
        <div className="flex flex-col gap-3">
          <PreflightChecklist
            items={checks.map((check) => ({
              id: check.id,
              ok: check.ok,
              label: check.label,
              action: check.action,
            }))}
          />
          <FundingChainSteps
            step={funding.step}
            awaitingStart={funding.step === 'idle'}
            approveTx={funding.approveTx}
            openTx={funding.openTx}
            onChainPolicyId={funding.fundingPlan?.onChainPolicyId}
            errorMessage={funding.errorMessage}
            className="border-[var(--units-stroke-color)] bg-[var(--units-wash-strong)]"
          />
        </div>
      ) : null}

      {fundingEnabled && tierUnresolved ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--units-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          未能确认已锁定的档位（可能是任务同步延迟），已展示全部方案；在你选定的档位上确认出资即可，不会重复开保。
        </p>
      ) : null}

      {displayPortfolios.length > 0 ? (
        <ComparisonMatrix
          portfolios={displayPortfolios}
          policyId={policyId ?? undefined}
          isProposed={fundingEnabled}
          selectedPortfolioId={selectedPortfolioId}
          showGlobalContext={false}
          fundingController={fundingEnabled ? funding : undefined}
          hideInlineFundingSteps={fundingEnabled}
        />
      ) : null}

      {canMintNft && policy ? (
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-display text-[16px] font-semibold tracking-tight text-foreground">
              {nftMinted ? '保单 NFT' : '下一步：铸造保单 NFT'}
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {nftMinted
                ? '凭证已上链，可在详情页分享公开页面。'
                : '出资开保已完成。铸造后获得确定性 ERC-721 凭证，每份保单限一枚。'}
            </p>
          </div>
          <PolicyNFTPanel policy={policy} />
        </section>
      ) : null}

      {isActive && policyId && policyQuery.isPending ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" />
          正在加载 NFT 铸造状态…
        </div>
      ) : null}

      {errorMessage && taskStatus !== 'failed' ? (
        <p className="text-[14px] text-destructive">{errorMessage}</p>
      ) : null}
    </StageShell>
  )
}
