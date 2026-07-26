import { useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Loader2,
  Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  CJK_SCRAMBLE_CHARS,
  DecryptedText,
} from '@/components/DecryptedText'
import { PolicyCommandRetry } from '@/features/agent/artifacts/PolicyCommandRetry'
import type { PortfolioOut, RiskFactorCategory } from '@/features/policy/policyApi'
import {
  formatUsd,
  scalePortfolioEconomics,
} from '@/features/policy/portfolioUtils'
import { WalletConnectButton } from '@/features/wallet/WalletConnectButton'
import { useWallet } from '@/features/wallet/useWallet'

import { ComparisonMatrix } from '../components/ComparisonMatrix'
import { TIER_LABELS } from '../components/matrixColumns'
import { StageShell } from '../components/StageShell'
import type { ModelExplanation, StageStatus } from '../types'

export interface CoveragePlanStageProps {
  title: string
  portfolios?: PortfolioOut[]
  policyId?: string
  factorCategories?: RiskFactorCategory[]
  onSelectPortfolio?: (portfolioId: string) => void
  selecting?: boolean
  stageStatus?: StageStatus
  errorMessage?: string | null
  onEnterPolicy?: () => void
  taskId?: string
  latestExplanation?: ModelExplanation | null
  selectedPortfolioId?: string | null
}

/**
 * Bridge panel between "选择档位" and "链上出资": shown immediately after the
 * user picks a tier, so the async approval submission + SSE stage swap reads
 * as one continuous handoff instead of a silent gap. Also blocks double
 * selection while the lock is in flight.
 */
function SelectionHandoffPanel({
  portfolio,
  selecting,
}: {
  portfolio?: PortfolioOut
  selecting: boolean
}) {
  const { isConnected, isWrongNetwork, switchToInjectiveTestnet } = useWallet()
  const tierLabel = portfolio ? TIER_LABELS[portfolio.tier] : '所选档位'
  const premium = portfolio?.premiumEstimate ?? null
  const economics =
    portfolio && premium != null
      ? scalePortfolioEconomics(portfolio, premium)
      : null

  const walletReady = isConnected && !isWrongNetwork
  const steps = [
    {
      label: `锁定「${tierLabel}」档位`,
      state: selecting ? ('running' as const) : ('done' as const),
    },
    {
      label: '生成出资计划，进入链上确认',
      state: selecting ? ('pending' as const) : ('running' as const),
    },
    {
      label: walletReady
        ? '钱包确认出资（授权 + 开保）'
        : '钱包确认出资（需先连接钱包）',
      state: 'pending' as const,
    },
  ]

  return (
    <section
      className="rounded-2xl border border-[color-mix(in_srgb,var(--units-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_6%,transparent)] px-4 py-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-semibold text-foreground">
          <DecryptedText
            text={`已选择「${tierLabel}」，正在衔接链上出资`}
            animateOn="view"
            sequential
            speed={30}
            characters={CJK_SCRAMBLE_CHARS}
            encryptedClassName="text-muted-foreground/50"
          />
        </p>
        {premium != null && economics ? (
          <p className="text-[12.5px] tabular-nums text-muted-foreground">
            保费 {formatUsd(premium)} → 最大赔付 {formatUsd(economics.maxPayout)}
          </p>
        ) : null}
      </div>
      <ol className="mt-3 flex flex-col gap-2.5">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3">
            {step.state === 'done' ? (
              <CheckCircle2 className="size-4 shrink-0 text-[var(--units-green)]" />
            ) : step.state === 'running' ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-[var(--units-orange)]" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={
                step.state === 'pending'
                  ? 'text-[13.5px] text-muted-foreground'
                  : 'text-[13.5px] text-foreground'
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {!walletReady ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-background px-3 py-2.5">
          <Wallet className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
            {isWrongNetwork
              ? '当前网络不对，请切换到 Injective 测试网后再出资。'
              : '趁准备出资计划的间隙，先把钱包连上，进入下一步就能直接确认。'}
          </p>
          {isWrongNetwork ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-full border-[var(--units-stroke-color)] px-3 text-[12.5px] shadow-none"
              onClick={() => void switchToInjectiveTestnet()}
            >
              切换网络
            </Button>
          ) : (
            <WalletConnectButton className="h-8 px-3 text-[12.5px]" />
          )}
        </div>
      ) : null}
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        锁定后如需更换档位，可在底部指令栏说明，系统会从安全检查点重新推导。
      </p>
    </section>
  )
}

export function CoveragePlanStage({
  title,
  portfolios = [],
  policyId,
  factorCategories = [],
  onSelectPortfolio,
  selecting = false,
  stageStatus,
  errorMessage,
  onEnterPolicy,
  taskId,
  latestExplanation,
  selectedPortfolioId,
}: CoveragePlanStageProps) {
  const { isConnected, isWrongNetwork } = useWallet()
  const awaiting = stageStatus === 'waiting_confirmation'
  const isLoading =
    portfolios.length === 0 &&
    (stageStatus === 'loading' || stageStatus === 'retry')

  // Locally tracked pick: keeps the handoff panel up between the click and
  // the SSE-driven stage swap (this component unmounts when it lands).
  // Derived, not effect-cleared: a selection failure (409 conflict / auth
  // expired) surfaces errorMessage, which drops the panel so the user can
  // read the error and pick again; re-picking resets the mutation error.
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(
    null
  )
  const handingOff = Boolean(pendingSelectionId) && !errorMessage

  const handleSelectPortfolio = onSelectPortfolio
    ? (portfolioId: string) => {
        if (handingOff || selecting) return
        setPendingSelectionId(portfolioId)
        onSelectPortfolio(portfolioId)
      }
    : undefined

  if (stageStatus === 'failed') {
    return (
      <StageShell
        stage="coverage_plan"
        title="方案生成未完成"
        description={
          errorMessage ??
          '市场候选已经保留，可以从当前步骤重新生成，无需再次填写问卷。'
        }
      >
        {taskId ? <PolicyCommandRetry taskId={taskId} /> : null}
      </StageShell>
    )
  }

  if (isLoading) {
    const steps = [
      { label: '确认有效市场候选', state: 'done' as const },
      { label: '比较风险暴露与保障边界', state: 'running' as const },
      { label: '生成保守、均衡、进取三档', state: 'pending' as const },
    ]
    return (
      <StageShell
        stage="coverage_plan"
        title={
          <DecryptedText
            text="正在生成你的保障方案"
            animateOn="view"
            sequential
            speed={40}
            characters={CJK_SCRAMBLE_CHARS}
            encryptedClassName="text-muted-foreground/50"
          />
        }
        description="已结束外部市场等待，正在使用已锁定的真实候选完成方案比较。"
        headerBelow={
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
            aria-hidden
          >
            <div className="units-loading-bar-fill h-full w-1/2 rounded-full bg-[var(--units-orange)]" />
          </div>
        }
      >
        <section
          className="rounded-2xl border border-[var(--units-stroke-color)] bg-background px-4 py-4"
          role="status"
          aria-live="polite"
        >
          <p className="text-[14px] font-medium leading-relaxed text-foreground">
            <DecryptedText
              text={
                latestExplanation?.stage === 'coverage_plan'
                  ? latestExplanation.summary
                  : '正在比较候选事件之间的相关性、流动性与赔付边界'
              }
              animateOn="view"
              sequential
              speed={22}
              characters={CJK_SCRAMBLE_CHARS}
              encryptedClassName="text-muted-foreground/50"
            />
          </p>
          <ol className="mt-4 flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                {step.state === 'done' ? (
                  <CheckCircle2 className="size-4 text-[var(--units-green)]" />
                ) : step.state === 'running' ? (
                  <Loader2 className="size-4 animate-spin text-[var(--units-orange)]" />
                ) : (
                  <Circle className="size-4 text-muted-foreground/40" />
                )}
                <span className="text-[13.5px] text-muted-foreground">
                  {step.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
            你可以继续使用底部指令栏补充偏好；新输入会从安全检查点重新推导。
          </p>
        </section>
      </StageShell>
    )
  }

  const pendingPortfolio = pendingSelectionId
    ? portfolios.find((portfolio) => portfolio.id === pendingSelectionId)
    : undefined
  const walletReady = isConnected && !isWrongNetwork

  if (handingOff) {
    return (
      <StageShell
        stage="coverage_plan"
        measure="board"
        title="档位已选择"
        description={title}
        aside={
          <span className="rounded-full border border-[color-mix(in_srgb,var(--units-orange)_32%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--units-orange)]">
            正在锁定档位
          </span>
        }
      >
        <SelectionHandoffPanel
          portfolio={pendingPortfolio}
          selecting={selecting}
        />
      </StageShell>
    )
  }

  return (
    <StageShell
      stage="coverage_plan"
      measure="board"
      title="你的保障方案已就绪"
      description={title}
      aside={
        awaiting ? (
          <span className="rounded-full border border-[color-mix(in_srgb,var(--units-orange)_32%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--units-orange)]">
            等待选择档位
          </span>
        ) : null
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-[13px] text-muted-foreground">
            {onSelectPortfolio && !walletReady
              ? '选择一档后进入链上出资；建议现在先连接钱包，出资时免等待'
              : '对比保费、赔付边界与暴露后，选择一档即可进入链上出资'}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onSelectPortfolio && !walletReady ? (
              <WalletConnectButton className="h-9 rounded-full border border-[var(--units-stroke-color)] px-3.5 text-[13px]" />
            ) : null}
            {onEnterPolicy ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0 rounded-full border-[var(--units-stroke-color)] px-3.5 text-[13px] shadow-none"
                onClick={onEnterPolicy}
              >
                查看保单详情
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <ComparisonMatrix
        portfolios={portfolios}
        policyId={policyId}
        isProposed
        factorCategories={factorCategories}
        selectedPortfolioId={selectedPortfolioId}
        onSelectPortfolio={handleSelectPortfolio}
        selecting={selecting}
        showGlobalContext={false}
      />

      {errorMessage ? (
        <p className="text-[14px] text-destructive">{errorMessage}</p>
      ) : null}
    </StageShell>
  )
}
