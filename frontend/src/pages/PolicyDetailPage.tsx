import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Gem, Radio, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { PhasedLoader } from '@/components/phased-loading'
import { cn } from '@/lib/utils'
import { isNotFoundError } from '@/lib/apiUtils'
import {
  getAgentTaskByPolicy,
} from '@/features/agent/agentApi'
import { createViewStateFromDetail } from '@/features/agent/eventReducer'
import {
  policyQueryKey,
  triggerSettle,
  usePolicyMarksQuery,
  usePolicyQuery,
} from '@/features/policy/policyApi'
import { useIsAdmin } from '@/features/auth/useIsAdmin'
import { PolicyMarksPanel } from '@/features/policy/PolicyMarksPanel'
import { PolicyResearchPanel } from '@/features/policy/PolicyResearchPanel'
import { PolicySettlementPanel } from '@/features/policy/PolicySettlementPanel'
import { PolicyStatusBadge } from '@/features/policy/PolicyStatusBadge'
import { PolicyTimeline } from '@/features/policy/PolicyTimeline'
import {
  PolicyEventsCalendar,
  eventsFromPolicyDetail,
} from '@/features/policy/PolicyEventsCalendar'
import { OnChainActivityPanel } from '@/features/policy/OnChainActivity'
import { PolicyNFTPanel } from '@/features/policy/PolicyNFTPanel'
import { OracleStatusPanel } from '@/features/policy/OracleStatusPanel'
import { OracleMetricsCard } from '@/features/policy/OracleMetricsCard'
import { SettlementProgressCard } from '@/features/policy/SettlementProgressCard'
import { useOracleStatusQuery } from '@/features/policy/useOracleStatus'
import { CopyableAddress } from '@/features/wallet/CopyableAddress'
import {
  formatCountdown,
  isCoverageExpired,
  isPolicyLocked,
  useReferenceTime,
} from '@/features/policy/policyStatus'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { ComparisonMatrix } from '@/features/policy-journey/components/ComparisonMatrix'
import { HealthScoreCard } from '@/features/policy-journey/components/HealthScoreCard'
import { computePolicyHealthScore } from '@/features/policy-journey/components/PolicyHealthScore'
import {
  PolicyDetailTabs,
  resolvePolicyDetailTab,
  type PolicyDetailTabId,
} from '@/features/policy-journey/components/PolicyDetailTabs'
import { createJourneyStateFromView } from '@/features/policy-journey/journeyReducer'

const TAB_DEFS: {
  id: PolicyDetailTabId
  label: string
  minStatus: string[]
}[] = [
  {
    id: 'overview',
    label: '概览',
    minStatus: [
      'intake',
      'composing',
      'proposed',
      'funded',
      'active',
      'settled',
      'failed',
    ],
  },
  {
    id: 'research',
    label: '研究',
    minStatus: [
      'composing',
      'proposed',
      'funded',
      'active',
      'settled',
      'failed',
    ],
  },
  {
    id: 'portfolio',
    label: '方案',
    minStatus: ['proposed', 'funded', 'active', 'settled'],
  },
  {
    id: 'ops',
    label: '运行',
    minStatus: ['funded', 'active', 'settled'],
  },
  {
    id: 'nft',
    label: 'NFT',
    minStatus: ['active', 'settled'],
  },
]

function statusToDefaultTab(status: string): PolicyDetailTabId {
  if (status === 'active' || status === 'settled') return 'overview'
  if (status === 'proposed' || status === 'funded') return 'portfolio'
  if (status === 'composing') return 'research'
  return 'overview'
}

function pickActiveTab(
  requested: PolicyDetailTabId | null,
  available: { id: PolicyDetailTabId }[],
  status: string
): PolicyDetailTabId {
  if (requested && available.some((t) => t.id === requested)) {
    return requested
  }
  const fallback = statusToDefaultTab(status)
  if (available.some((t) => t.id === fallback)) return fallback
  return available[0]?.id ?? 'overview'
}

export function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const nowMs = useReferenceTime()
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()
  const policyQuery = usePolicyQuery(id, { pollSettled: true })
  const policy = policyQuery.data
  const [settleLoading, setSettleLoading] = useState(false)
  const [settleQueued, setSettleQueued] = useState(false)

  const handleTriggerSettle = useCallback(async () => {
    if (!id || settleLoading) return
    setSettleLoading(true)
    try {
      await triggerSettle(id)
      setSettleQueued(true)
      // Start polling for status change
      void queryClient.invalidateQueries({ queryKey: policyQueryKey(id) })
    } catch (err) {
      console.error('trigger settle failed', err)
    } finally {
      setSettleLoading(false)
    }
  }, [id, settleLoading, queryClient])

  const requestedTab = resolvePolicyDetailTab(searchParams.get('tab'))
  const [activeTab, setActiveTab] = useState<PolicyDetailTabId | null>(
    requestedTab
  )

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab)
  }, [requestedTab])

  const marksQuery = usePolicyMarksQuery(id, {
    status: policy?.status,
    enabled: policy?.status === 'active',
  })

  const agentTaskQuery = useQuery({
    queryKey: ['agent-task-by-policy', id],
    queryFn: async () => {
      try {
        return await getAgentTaskByPolicy(id as string)
      } catch (error) {
        // No linked agent task is a valid state for some policies.
        if (isNotFoundError(error)) return null
        throw error
      }
    },
    enabled: Boolean(id),
    retry: false,
  })

  const explanations = useMemo(() => {
    if (!agentTaskQuery.data) return []
    const view = createViewStateFromDetail(agentTaskQuery.data)
    return createJourneyStateFromView(view).explanations
  }, [agentTaskQuery.data])

  const isAwaitingSettle =
    policy?.status === 'active' &&
    policy.coverageEnd != null &&
    isCoverageExpired(policy.coverageEnd, nowMs)
  const isSettledForOracle = policy?.status === 'settled'
  const oracleEnabled = Boolean(isAwaitingSettle || isSettledForOracle)

  const oracleQuery = useOracleStatusQuery(id, {
    enabled: oracleEnabled,
    poll: Boolean(isAwaitingSettle),
  })

  // Derive whether settlement is already in progress from oracle data.
  // If any leg has status > 0, the relayer has already started work.
  const settleInProgress = useMemo(() => {
    if (!oracleQuery.data || oracleQuery.data.mode === 'legacy') return false
    return oracleQuery.data.legs.some((l) => l.status > 0)
  }, [oracleQuery.data])

  // Oracle data must be loaded before allowing admin to trigger settlement.
  // This prevents double-queueing: we first check chain state, then decide.
  const oracleLoaded = oracleQuery.isSuccess && oracleQuery.data != null

  // The button should be disabled until oracle loads, then once triggered/in-progress.
  const settleTriggered = settleQueued || settleInProgress

  if (policyQuery.isPending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <PhasedLoader
          stage="on_chain_active"
          status="loading"
          message="加载保单详情…"
        />
      </div>
    )
  }

  if (policyQuery.isError || !policy) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          加载保障方案失败，请稍后重试
        </p>
      </div>
    )
  }

  const availableTabs = TAB_DEFS.filter((tab) =>
    tab.minStatus.includes(policy.status)
  )
  const currentTab = pickActiveTab(activeTab, availableTabs, policy.status)

  const countdown = formatCountdown(policy.coverageEnd)
  const isActive = policy.status === 'active'
  const isSettled = policy.status === 'settled'
  const locked = isPolicyLocked(policy.status)

  const selectedPortfolio =
    policy.portfolios.find((p) => p.id === policy.selectedPortfolioId) ??
    policy.portfolios[0]
  const maxPayout = policy.payout ?? selectedPortfolio?.expectedPayout ?? null

  const health = computePolicyHealthScore({
    policy,
    marks: marksQuery.data,
    // Only the initial in-flight fetch — background refetch must not suppress risks.
    marksLoading: marksQuery.isPending,
    marksError: marksQuery.isError,
    explanations,
    nowMs,
  })

  return (
    <div className="flex h-full flex-col overflow-hidden units-app-panel">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/home"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            看板
          </Link>

          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--units-green)]">
              <Radio className="size-3" />
              已锁定
            </span>
          )}

          {policy.onChainPolicyId && (
            <CopyableAddress
              address={policy.onChainPolicyId}
              head={8}
              tail={6}
              size="sm"
            />
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="units-text-title text-foreground">
            {policy.title}
          </h1>
          <PolicyStatusBadge status={policy.status} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
          {policy.coverageEnd && (
            <span>
              截止 {policy.coverageEnd.slice(0, 10)}
              {countdown && isActive && (
                <span
                  className={cn(
                    'ml-1',
                    countdown === '已到期'
                      ? 'font-semibold text-[var(--units-orange)]'
                      : ''
                  )}
                >
                  ({countdown === '已到期' ? '待结算' : `剩余 ${countdown}`})
                </span>
              )}
            </span>
          )}
          {isAdmin && isAwaitingSettle && (
            <Button
              type="button"
              size="sm"
              disabled={!oracleLoaded || settleLoading || settleTriggered}
              onClick={handleTriggerSettle}
              className="h-7 gap-1.5 rounded-full bg-[var(--units-orange)] px-3 text-[11px] font-semibold text-white hover:bg-[var(--units-orange)]/90 disabled:opacity-50"
            >
              <Zap className="size-3" />
              {settleTriggered
                ? '结算进行中'
                : settleLoading
                  ? '提交中…'
                  : !oracleLoaded
                    ? '连接中…'
                    : '一键结算'}
            </Button>
          )}
          {policy.premium != null && (
            <span className="rounded-full bg-secondary px-2 py-0.5">
              保费 {formatUsd(policy.premium)}
            </span>
          )}
          {maxPayout != null && (
            <span className="rounded-full bg-secondary px-2 py-0.5">
              最大赔付 {formatUsd(maxPayout)}
            </span>
          )}
        </div>
      </header>

      <PolicyDetailTabs
        tabs={availableTabs}
        active={currentTab}
        onChange={setActiveTab}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {currentTab === 'overview' && (
          <div className="space-y-6">
            <HealthScoreCard health={health} />

            {isActive && !isAwaitingSettle && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_8%,transparent)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--units-green)]">
                  ACTIVE COVERAGE
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  保障已生效
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {policy.needText}
                </p>
              </div>
            )}

            {(isActive || isSettled) && !policy.nftTokenId ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-wash-strong)] px-4 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <Gem className="size-4 text-[var(--units-orange)]" />
                    可铸造保单 NFT
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    出资开保后即可铸造成链上凭证，每份保单限一枚。
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0 rounded-full px-3.5 text-[13px]"
                  onClick={() => setActiveTab('nft')}
                >
                  去铸造
                </Button>
              </div>
            ) : null}

            {(isActive || isSettled) && policy.nftTokenId ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_8%,transparent)] px-4 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <Gem className="size-4 text-[var(--units-green)]" />
                    保单 NFT 已铸造
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
                    Token #{policy.nftTokenId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 rounded-full border-[var(--units-stroke-color)] px-3.5 text-[13px] shadow-none"
                  onClick={() => setActiveTab('nft')}
                >
                  查看凭证
                </Button>
              </div>
            ) : null}

            {oracleEnabled && (
              <SettlementProgressCard
                policy={policy}
                oracle={oracleQuery.data}
                settleQueued={settleTriggered}
              />
            )}

            {policy.needText && !isActive && (
              <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">
                {policy.needText}
              </p>
            )}

            {(policy.factorCategories?.length ?? 0) > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-foreground">
                  风险因素类别
                </h2>
                <div className="flex flex-wrap gap-2">
                  {policy.factorCategories!.map((cat) => (
                    <span
                      key={cat.id}
                      title={cat.rationale}
                      className="inline-flex max-w-sm flex-col rounded-xl border border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] px-3 py-2"
                    >
                      <span className="text-[12px] font-semibold text-foreground">
                        {cat.label}
                      </span>
                      {cat.rationale ? (
                        <span className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                          {cat.rationale}
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  状态时间线
                </h2>
                <PolicyTimeline policy={policy} />
              </section>
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  事件日历
                </h2>
                <PolicyEventsCalendar
                  events={eventsFromPolicyDetail(policy)}
                />
              </section>
            </div>
          </div>
        )}

        {currentTab === 'research' && (
          <PolicyResearchPanel
            policyId={id}
            factorCategories={policy.factorCategories}
            explanations={explanations}
          />
        )}

        {currentTab === 'portfolio' && (
          <div className="space-y-6">
            <section>
              <div className="mb-4">
                <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
                  {policy.status === 'proposed' ? '三档方案对比' : '保障组合'}
                </h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {policy.status === 'proposed'
                    ? '对比保费与赔付边界，选择一档后出资'
                    : '当前生效档位与备选方案'}
                </p>
              </div>
              <ComparisonMatrix
                portfolios={policy.portfolios}
                policyId={id}
                isProposed={policy.status === 'proposed'}
                selectedPortfolioId={policy.selectedPortfolioId}
                onChainPolicyId={policy.onChainPolicyId ?? undefined}
                openTx={policy.openTx ?? undefined}
                factorCategories={policy.factorCategories}
                showGlobalContext={false}
              />
            </section>
          </div>
        )}

        {currentTab === 'ops' && (
          <div className="space-y-8">
            {isActive && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  实时盯市
                </h2>
                <PolicyMarksPanel
                  policy={policy}
                  marksQuery={marksQuery}
                  referenceTimeMs={nowMs}
                />
              </section>
            )}

            <section>
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                链上活动
              </h2>
              <OnChainActivityPanel
                openTx={policy.openTx}
                settleTx={policy.settleTx}
                onChainPolicyId={policy.onChainPolicyId}
                status={policy.status}
                oracleAddress={oracleQuery.data?.oracleAddress}
              />
            </section>

            {oracleEnabled && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {isSettled ? '预言机结算结果' : '预言机结算状态'}
                </h2>
                <OracleStatusPanel
                  policyId={id}
                  enabled={oracleEnabled}
                  poll={Boolean(isAwaitingSettle)}
                />
                {oracleQuery.data &&
                  oracleQuery.data.mode !== 'legacy' && (
                    <div className="mt-4">
                      <OracleMetricsCard data={oracleQuery.data} />
                    </div>
                  )}
              </section>
            )}

            {(isAwaitingSettle || isSettled) && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {isSettled ? '结算综合' : '结算进度与预期赔付'}
                </h2>
                <SettlementProgressCard
                  policy={policy}
                  oracle={oracleQuery.data}
                  settleQueued={settleTriggered}
                />
              </section>
            )}

            {isSettled && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  结算结果
                </h2>
                <PolicySettlementPanel policy={policy} />
              </section>
            )}

            {(isActive || isSettled) && (
              <section className="rounded-xl border border-[var(--units-stroke-color)] px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">
                      保单 NFT
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {policy.nftTokenId
                        ? '凭证已铸造，可在 NFT 页查看与分享'
                        : '保障生效后可铸造成链上凭证'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-full border-[var(--units-stroke-color)] px-3.5 text-[13px] shadow-none"
                    onClick={() => setActiveTab('nft')}
                  >
                    <Gem className="size-3.5" />
                    {policy.nftTokenId ? '查看 NFT' : '去铸造 NFT'}
                  </Button>
                </div>
              </section>
            )}

            {!isActive && !isSettled && !policy.openTx && (
              <p className="text-sm text-muted-foreground">
                出资确认后将显示链上活动与监控数据
              </p>
            )}
          </div>
        )}

        {currentTab === 'nft' && (isActive || isSettled) && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-[18px] font-semibold tracking-tight text-foreground">
                保单 NFT
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {policy.nftTokenId
                  ? '这枚凭证对应当前保单的确定性链上身份，可分享公开页面。'
                  : '出资开保后即可铸造。铸造不改变保障与结算规则，每份保单限一枚。'}
              </p>
            </div>
            <PolicyNFTPanel policy={policy} />
          </div>
        )}
      </div>
    </div>
  )
}
