import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Search,
  SearchX,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { ModelObservationHistory } from '@/features/policy-journey/components/ModelObservationHistory'
import type { ModelExplanation } from '@/features/policy-journey/types'

import { GlobalContextPanel } from './GlobalContextPanel'
import {
  usePolicyResearchQuery,
  type ResearchCandidate,
  type ResearchSearchStatus,
  type RiskFactorCategory,
} from './policyApi'

type FilterMode = 'all' | 'selected' | 'pool'

const SEARCH_STATUS_LABEL: Record<ResearchSearchStatus, string> = {
  searching: '检索中',
  searched: '检索完成',
  failed: '检索失败',
}

function formatCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatResearchedAt(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CandidateRow({ candidate }: { candidate: ResearchCandidate }) {
  const selected = candidate.selection === 'selected'
  const endLabel = candidate.endDate
    ? candidate.endDate.slice(0, 10)
    : null
  const yesPct =
    candidate.yesPriceBps != null
      ? `${(candidate.yesPriceBps / 100).toFixed(1)}%`
      : null

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border px-3 py-2.5',
        selected
          ? 'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_8%,transparent)]'
          : 'border-border bg-secondary/10'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              #{candidate.rank}
            </span>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--units-blue)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--units-blue)]">
              {candidate.platform}
            </span>
            {selected && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--units-green)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--units-green)]">
                <CheckCircle2 className="size-3" />
                已入组合
              </span>
            )}
            {candidate.category ? (
              <span className="text-[10px] text-muted-foreground">
                {candidate.category}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] font-medium leading-5 text-foreground">
            {candidate.question}
          </p>
        </div>
        {candidate.url ? (
          <a
            href={candidate.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-[var(--units-stroke-strong)] hover:text-foreground"
          >
            打开
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>成交量 {formatCompact(candidate.volume)}</span>
        <span>流动性 {formatCompact(candidate.liquidity)}</span>
        {yesPct ? <span>YES {yesPct}</span> : null}
        {endLabel ? <span>到期 {endLabel}</span> : null}
      </div>
    </li>
  )
}

export function PolicyResearchPanel({
  policyId,
  factorCategories,
  explanations,
}: {
  policyId: string | undefined
  factorCategories?: RiskFactorCategory[]
  explanations: ModelExplanation[]
}) {
  const [filter, setFilter] = useState<FilterMode>('all')
  const researchQuery = usePolicyResearchQuery(policyId, {
    enabled: Boolean(policyId),
  })
  const research = researchQuery.data

  const filtered = useMemo(() => {
    const list = research?.candidates ?? []
    if (filter === 'selected') {
      return list.filter((c) => c.selection === 'selected')
    }
    if (filter === 'pool') {
      return list.filter((c) => c.selection === 'pool')
    }
    return list
  }, [research?.candidates, filter])

  const selectedCount = research?.selectedConditionIds.length ?? 0
  const researchedAtLabel = formatResearchedAt(research?.researchedAt ?? null)
  const isSearching = research?.searchStatus === 'searching'
  const isFailed = research?.searchStatus === 'failed'
  const hasCandidates = (research?.totalCount ?? 0) > 0

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">市场研究</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            该保单检索到的预测市场候选池，含排序与入选关系
          </p>
        </div>

        {researchQuery.isPending && !research ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/15 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载研究数据…
          </div>
        ) : researchQuery.isError ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            无法加载研究数据，请稍后重试
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/15 px-3 py-2.5 text-[12px]">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  isSearching &&
                    'bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] text-[var(--units-orange)]',
                  research?.searchStatus === 'searched' &&
                    'bg-[color-mix(in_srgb,var(--units-green)_14%,transparent)] text-[var(--units-green)]',
                  isFailed && 'bg-destructive/10 text-destructive'
                )}
              >
                {isSearching ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : isFailed ? (
                  <SearchX className="size-3" />
                ) : (
                  <Search className="size-3" />
                )}
                {research
                  ? SEARCH_STATUS_LABEL[research.searchStatus]
                  : '未知'}
              </span>
              <span className="text-muted-foreground">
                候选 {research?.totalCount ?? 0}
                {research && research.returnedCount < research.totalCount
                  ? ` · 展示 ${research.returnedCount}`
                  : ''}
              </span>
              <span className="text-muted-foreground">
                入选 {selectedCount}
              </span>
              {(research?.platforms ?? []).map((p) => (
                <span
                  key={p.platform}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground"
                >
                  {p.platform} · {p.count}
                </span>
              ))}
              {researchedAtLabel ? (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  池更新 {researchedAtLabel}
                </span>
              ) : null}
            </div>

            {isSearching && !hasCandidates ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                正在检索可投保的预测市场…
              </div>
            ) : null}

            {isFailed && !hasCandidates ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] px-4 py-4 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--units-orange)]" />
                <div>
                  <p className="font-medium">未找到可用市场或检索失败</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    当前关键词下没有可投保的预测市场，或检索服务暂时不可用。
                  </p>
                </div>
              </div>
            ) : null}

            {hasCandidates ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['all', '全部'],
                      ['selected', '已入选'],
                      ['pool', '候选池'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
                        filter === id
                          ? 'bg-foreground text-background'
                          : 'bg-secondary text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {label}
                      {id === 'selected' ? ` ${selectedCount}` : ''}
                      {id === 'all' && research
                        ? ` ${research.returnedCount}`
                        : ''}
                    </button>
                  ))}
                </div>

                {filtered.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    当前筛选下没有市场
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {filtered.map((candidate) => (
                      <CandidateRow
                        key={candidate.conditionId}
                        candidate={candidate}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </>
        )}
      </section>

      {(research?.sources?.length ?? 0) > 0 ? (
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">采集来源</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              研究时点多源快照（非实时全球面板）
            </p>
          </div>
          <ul className="space-y-2">
            {research!.sources!.map((source) => (
              <li
                key={source.kind}
                className="rounded-xl border border-border bg-secondary/10 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {source.kind}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {source.status}
                    {source.itemCount != null ? ` · ${source.itemCount}` : ''}
                  </span>
                </div>
                {source.summary ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {source.summary}
                  </p>
                ) : null}
                {source.errorMessage ? (
                  <p className="mt-1 text-[12px] text-destructive">
                    {source.errorMessage}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-foreground">全球上下文</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            当前全球信号，非研究时点快照
          </p>
        </div>
        <GlobalContextPanel factorCategories={factorCategories} />
      </section>

      <section>
        <ModelObservationHistory explanations={explanations} />
      </section>
    </div>
  )
}
