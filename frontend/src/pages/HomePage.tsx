import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { AgentInputPayload } from '@/components/AgentInput'
import {
  HomeDashboardMetrics,
  type HomeDashboardStats,
} from '@/features/home/HomeDashboardMetrics'
import { HomeDashboardSidebar } from '@/features/home/HomeDashboardSidebar'
import { HomeHeroSection } from '@/features/home/HomeHeroSection'
import { HomePolicyWorkspace } from '@/features/home/HomePolicyWorkspace'
import { usePoliciesQuery } from '@/features/policy/policyApi'
import {
  isCoverageExpired,
  useReferenceTime,
  type PolicyFilterTab,
} from '@/features/policy/policyStatus'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { cn } from '@/lib/utils'

export function HomePage() {
  const navigate = useNavigate()
  const policiesQuery = usePoliciesQuery()
  const [filter, setFilter] = useState<PolicyFilterTab>('all')
  const [settlementFocus, setSettlementFocus] = useState(false)
  const [draft, setDraft] = useState('')
  const [taskError, setTaskError] = useState<string | null>(null)
  const nowMs = useReferenceTime()

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

  const handleAgentTask = (payload: AgentInputPayload) => {
    setTaskError(null)
    navigate('/tasks/new', {
      state: {
        agentTaskLaunch: {
          goalText: payload.content,
          displayText: payload.displayText,
          clientRequestId: crypto.randomUUID(),
        },
      },
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
      {/* Hero: focused chat entry point */}
      <HomeHeroSection
        draft={draft}
        onDraftChange={setDraft}
        onSendTask={handleAgentTask}
        taskError={taskError}
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
            <p className="hidden text-[11.5px] text-muted-foreground sm:block">
              汇总生效保障、结算节点与快捷入口
            </p>
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
