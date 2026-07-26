import { useMemo } from 'react'
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Gem,
  ShieldCheck,
  X,
} from 'lucide-react'

import { PixelArt } from '@/components/pixel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PolicyListSkeleton } from '@/features/conversation/ConversationToolSkeleton'
import type { PolicyListItem } from '@/features/policy/policyApi'
import { PolicyStatusBadge } from '@/features/policy/PolicyStatusBadge'
import {
  isCoverageExpired,
  matchesPolicyFilter,
  type PolicyFilterTab,
} from '@/features/policy/policyStatus'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { cn } from '@/lib/utils'

const FILTER_TABS: { value: PolicyFilterTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'in_progress', label: '进行中' },
  { value: 'active', label: '已生效' },
  { value: 'settled', label: '已结算' },
]

const TIER_LABELS: Record<string, string> = {
  conservative: '稳健型',
  balanced: '均衡型',
  aggressive: '激进型',
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 1,
  proposed: 2,
  funded: 2,
  composing: 3,
  intake: 3,
  settled: 4,
  failed: 5,
}

function formatCoverageCountdown(
  endIso: string | null | undefined,
  referenceTimeMs: number
): string | null {
  if (!endIso) return null
  const endMs = new Date(endIso).getTime()
  if (!Number.isFinite(endMs)) return null

  const diffMs = endMs - referenceTimeMs
  if (diffMs <= 0) return '已到期'

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时`

  const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)))
  return `${minutes} 分钟`
}

function policyPriority(policy: PolicyListItem, referenceTimeMs: number) {
  if (
    policy.status === 'active' &&
    isCoverageExpired(policy.coverageEnd, referenceTimeMs)
  ) {
    return 0
  }
  return STATUS_PRIORITY[policy.status] ?? 6
}

interface HomePolicyWorkspaceProps {
  policies: PolicyListItem[]
  isPending: boolean
  isError: boolean
  filter: PolicyFilterTab
  settlementFocus: boolean
  referenceTimeMs: number
  onFilterChange: (filter: PolicyFilterTab) => void
  onClearSettlementFocus: () => void
  onFocusPending: () => void
  onNewPolicy: () => void
  onOpenPolicy: (policyId: string) => void
  onViewSchedule: () => void
}

export function HomePolicyWorkspace({
  policies,
  isPending,
  isError,
  filter,
  settlementFocus,
  referenceTimeMs,
  onFilterChange,
  onClearSettlementFocus,
  onFocusPending,
  onNewPolicy,
  onOpenPolicy,
  onViewSchedule,
}: HomePolicyWorkspaceProps) {
  const pendingSettleCount = useMemo(
    () =>
      policies.filter(
        (policy) =>
          policy.status === 'active' &&
          isCoverageExpired(policy.coverageEnd, referenceTimeMs)
      ).length,
    [policies, referenceTimeMs]
  )

  const visiblePolicies = useMemo(() => {
    const result = policies.filter((policy) => {
      if (settlementFocus) {
        return (
          policy.status === 'active' &&
          isCoverageExpired(policy.coverageEnd, referenceTimeMs)
        )
      }
      return matchesPolicyFilter(policy.status, filter)
    })

    return [...result].sort((a, b) => {
      const priorityDiff =
        policyPriority(a, referenceTimeMs) - policyPriority(b, referenceTimeMs)
      if (priorityDiff !== 0) return priorityDiff

      const aEnd = a.coverageEnd ? new Date(a.coverageEnd).getTime() : Infinity
      const bEnd = b.coverageEnd ? new Date(b.coverageEnd).getTime() : Infinity
      if (aEnd !== bEnd) return aEnd - bEnd
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [filter, policies, referenceTimeMs, settlementFocus])

  return (
    <section className="min-w-0 rounded-md border border-zinc-200/80 bg-zinc-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md border border-zinc-200/80 bg-[var(--units-blue)] text-white">
              <ShieldCheck className="size-4" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                保障总览
              </p>
              <h2 className="text-lg font-semibold tracking-tight">
                我的保单
              </h2>
            </div>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            已到期保单优先排列，其后是生效保障和仍待完成的方案。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onViewSchedule}
          className="h-8 rounded-md border px-3 text-[12px] shadow-none"
        >
          结算日程
          <ArrowRight className="size-3.5" />
        </Button>
      </div>

      {pendingSettleCount > 0 ? (
        <button
          type="button"
          onClick={onFocusPending}
          className={cn(
            'mt-3 flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
            settlementFocus
              ? 'border-[var(--units-stroke-color)] bg-[var(--units-orange)] text-[var(--units-on-accent)]'
              : 'border-[color-mix(in_srgb,var(--units-orange)_38%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] hover:border-[var(--units-orange)]'
          )}
        >
          <CircleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold">
              {pendingSettleCount} 份保障已到期，等待结算
            </span>
            <span className="mt-0.5 block text-[11px] opacity-75">
              {settlementFocus ? '当前仅显示真实到期保单' : '点击聚焦并逐份核对结果'}
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </button>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--units-stroke-color)]">
        <Tabs
          value={filter}
          onValueChange={(value) => onFilterChange(value as PolicyFilterTab)}
        >
          <TabsList variant="line" className="w-full justify-start">
            {FILTER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="pb-2 text-[11px] font-medium text-muted-foreground">
          {visiblePolicies.length} 份记录
        </span>
      </div>

      {settlementFocus ? (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] px-2.5 py-1.5 text-[11.5px]">
          <span className="font-medium text-[var(--units-orange)]">
            已开启待结算聚焦
          </span>
          <button
            type="button"
            onClick={onClearSettlementFocus}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
            清除
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        {isPending ? <PolicyListSkeleton /> : null}

        {isError ? (
          <div className="rounded-lg border border-dashed border-destructive/35 px-4 py-10 text-center">
            <p className="text-sm text-destructive">保单列表加载失败</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              请检查网络后重试
            </p>
          </div>
        ) : null}

        {!isPending && !isError && visiblePolicies.length === 0 ? (
          <div className="units-stage-enter flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 px-3 py-10 text-center">
            {policies.length === 0 ? (
              <>
                <PixelArt
                  pattern="care"
                  animate
                  size="sm"
                  label="xEngine 守护"
                  className="rounded-sm"
                />
                <p className="mt-4 text-sm font-medium text-foreground">
                  还没有保单
                </p>
                <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                  描述一次真实担忧，xEngine 会将它拆成风险问卷，再生成可出资的三档方案。
                </p>
                <Button
                  type="button"
                  onClick={onNewPolicy}
                  className="units-cta mt-4 h-9 rounded-md px-4 font-semibold shadow-none"
                >
                  发起第一份保单
                </Button>
              </>
            ) : settlementFocus ? (
              <>
                <CalendarClock className="size-8 text-[var(--units-green)]" />
                <p className="mt-3 text-sm font-medium">没有待结算保单</p>
                <button
                  type="button"
                  onClick={onClearSettlementFocus}
                  className="mt-2 text-[12px] font-medium text-[var(--units-orange)] hover:underline"
                >
                  返回全部保单
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                该筛选下暂无保单，换个标签看看
              </p>
            )}
          </div>
        ) : null}

        <div className="units-stagger grid gap-2.5">
          {visiblePolicies.map((policy) => {
            const countdown = formatCoverageCountdown(
              policy.coverageEnd,
              referenceTimeMs
            )
            const isPendingSettlement =
              policy.status === 'active' &&
              isCoverageExpired(policy.coverageEnd, referenceTimeMs)

            return (
              <button
                key={policy.id}
                type="button"
                onClick={() => onOpenPolicy(policy.id)}
                className={cn(
                  'flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
                  isPendingSettlement
                    ? 'border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_8%,var(--background))]'
                    : 'border-border bg-background hover:bg-zinc-100/60'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PolicyStatusBadge status={policy.status} />
                  {policy.hasNft ? (
                    <Badge variant="secondary">
                      <Gem />
                      已铸造
                    </Badge>
                  ) : policy.status === 'active' || policy.status === 'settled' ? (
                    <Badge variant="outline">
                      <Gem />
                      可铸造 NFT
                    </Badge>
                  ) : null}
                  {isPendingSettlement ? (
                    <span className="rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--units-orange)]">
                      待结算
                    </span>
                  ) : null}
                  {policy.selectedPortfolioTier ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                      {TIER_LABELS[policy.selectedPortfolioTier] ??
                        policy.selectedPortfolioTier}
                    </span>
                  ) : null}
                  {countdown && policy.status === 'active' ? (
                    <span
                      className={cn(
                        'ml-auto text-[11px]',
                        isPendingSettlement
                          ? 'font-semibold text-[var(--units-orange)]'
                          : 'text-muted-foreground'
                      )}
                    >
                      {isPendingSettlement ? '已到期' : `剩余 ${countdown}`}
                    </span>
                  ) : null}
                </div>
                <h3 className="line-clamp-2 text-[14px] font-semibold text-foreground">
                  {policy.title || '未命名保单'}
                </h3>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                  {policy.premium != null ? (
                    <span>保费 {formatUsd(policy.premium)}</span>
                  ) : null}
                  {policy.expectedPayout != null ? (
                    <span>最大赔付 {formatUsd(policy.expectedPayout)}</span>
                  ) : null}
                  {policy.coverageEnd ? (
                    <span>截止 {policy.coverageEnd.slice(0, 10)}</span>
                  ) : null}
                  <span className="text-muted-foreground/70">
                    更新 {policy.updatedAt?.slice(0, 10)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
