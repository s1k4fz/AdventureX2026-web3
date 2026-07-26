import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  HomeDashboardMetrics,
  type HomeDashboardStats,
} from '@/features/home/HomeDashboardMetrics'
import { HomeDashboardSidebar } from '@/features/home/HomeDashboardSidebar'
import { HomeHeroSection } from '@/features/home/HomeHeroSection'
import { HomePolicyWorkspace } from '@/features/home/HomePolicyWorkspace'
import {
  createDemoPendingSettlePolicy,
  policiesListQueryKey,
  usePoliciesQuery,
} from '@/features/policy/policyApi'
import {
  isCoverageExpired,
  useReferenceTime,
  type PolicyFilterTab,
} from '@/features/policy/policyStatus'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { cn } from '@/lib/utils'

export function HomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const policiesQuery = usePoliciesQuery()
  const [filter, setFilter] = useState<PolicyFilterTab>('all')
  const [settlementFocus, setSettlementFocus] = useState(false)
  const [draft, setDraft] = useState('')
  const nowMs = useReferenceTime()

  // 演示加速器：在真实测试网开一张已到期保单（2-3 笔链上交易，约 1 分钟），
  // 成功后直接进入详情页演示「一键结算」。
  const demoMutation = useMutation({
    mutationFn: createDemoPendingSettlePolicy,
    onSuccess: (policy) => {
      void queryClient.invalidateQueries({ queryKey: policiesListQueryKey() })
      navigate(`/policy/${policy.id}`)
    },
  })

  // Scroll-driven blur fade: the secondary section starts blurred and
  // becomes clear as the user scrolls past the hero.
  const secondaryRef = useRef<HTMLDivElement>(null)
  const [blurOpacity, setBlurOpacity] = useState(1)

  const handleScroll = useCallback(() => {
    const el = secondaryRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const viewportH = window.innerHeight
    // As the section enters the viewport from below, fade blur from 1→0
    const progress = Math.max(0, Math.min(1, (viewportH - rect.top) / (viewportH * 0.35)))
    setBlurOpacity(1 - progress)
  }, [])

  useEffect(() => {
    const container = secondaryRef.current?.closest('.units-app-panel')
    if (!container) return
    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const policies = useMemo(
    () => policiesQuery.data ?? [],
    [policiesQuery.data]
  )

  const stats = useMemo<HomeDashboardStats>(() => {
    const active = policies.filter((policy) => policy.status === 'active')
    const pendingSettle = active.filter((policy) =>
      isCoverageExpired(policy.coverageEnd, nowMs)
    )

    return {
      activeCount: active.length,
      totalCoverage: active.reduce(
        (sum, policy) => sum + (policy.expectedPayout ?? 0),
        0
      ),
      totalPremium: policies
        .filter(
          (policy) =>
            policy.status === 'active' || policy.status === 'settled'
        )
        .reduce((sum, policy) => sum + (policy.premium ?? 0), 0),
      pendingSettle: pendingSettle.length,
    }
  }, [nowMs, policies])

  const handleNewPolicy = () => {
    navigate('/tasks/new')
  }

  // 首页只收集一句需求草稿；创建统一在工作台表单确认后发起。
  const handleEnterWorkbench = (needText: string) => {
    navigate('/tasks/new', {
      state: needText ? { draftNeedText: needText } : undefined,
    })
  }

  const handleFocusPending = () => {
    setFilter('active')
    setSettlementFocus(true)
    secondaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleBrowsePanel = () => {
    secondaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleFilterChange = (nextFilter: PolicyFilterTab) => {
    setFilter(nextFilter)
    setSettlementFocus(false)
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto units-app-panel">
      {/* Hero: focused workbench entry point */}
      <HomeHeroSection
        draft={draft}
        onDraftChange={setDraft}
        onEnterWorkbench={handleEnterWorkbench}
        stats={stats}
        formattedCoverage={formatUsd(stats.totalCoverage)}
        onBrowsePanel={handleBrowsePanel}
        onFocusPending={handleFocusPending}
      />

      {/* Secondary content: dashboard metrics + policy workspace + sidebar */}
      <div ref={secondaryRef} className="relative">
        {/* Gaussian blur overlay that fades on scroll */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-10 backdrop-blur-[8px] transition-opacity duration-300',
            blurOpacity <= 0.02 && 'hidden'
          )}
          style={{ opacity: blurOpacity }}
          aria-hidden
        />

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 sm:px-5">
          <header className="flex items-end justify-between gap-3 px-0.5 pb-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Portfolio
              </p>
              <h2 className="mt-0.5 text-lg font-semibold tracking-tight">
                保障面板
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={demoMutation.isPending}
                  onClick={() => demoMutation.mutate()}
                  className="h-8 shrink-0 gap-1.5 rounded-full border-[var(--units-stroke-color)] px-3.5 text-[12px] font-semibold shadow-none"
                >
                  <FlaskConical className="size-3.5 text-[var(--units-orange)]" />
                  {demoMutation.isPending
                    ? '链上开单中，约 1 分钟…'
                    : '一键创建待结算保单'}
                </Button>
                {demoMutation.isError ? (
                  <p className="mt-1 text-[11px] text-destructive">
                    创建失败，请稍后重试
                  </p>
                ) : null}
              </div>
              <p className="hidden text-[11.5px] text-muted-foreground sm:block">
                汇总生效保障、结算节点与快捷入口
              </p>
            </div>
          </header>

          <HomeDashboardMetrics
            stats={stats}
            formattedCoverage={formatUsd(stats.totalCoverage)}
            formattedPremium={formatUsd(stats.totalPremium)}
            onFocusPending={handleFocusPending}
          />

          <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]">
            <HomePolicyWorkspace
              policies={policies}
              isPending={policiesQuery.isPending}
              isError={policiesQuery.isError}
              filter={filter}
              settlementFocus={settlementFocus}
              referenceTimeMs={nowMs}
              onFilterChange={handleFilterChange}
              onClearSettlementFocus={() => setSettlementFocus(false)}
              onFocusPending={handleFocusPending}
              onNewPolicy={handleNewPolicy}
              onOpenPolicy={(policyId) => navigate(`/policy/${policyId}`)}
              onViewSchedule={() => navigate('/schedule')}
            />

            <HomeDashboardSidebar
              policies={policies}
              referenceTimeMs={nowMs}
              onNewPolicy={handleNewPolicy}
              onOpenPolicy={(policyId) => navigate(`/policy/${policyId}`)}
              onViewSchedule={() => navigate('/schedule')}
              onViewVault={() => navigate('/vault')}
              onViewCollection={() => navigate('/collection')}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
