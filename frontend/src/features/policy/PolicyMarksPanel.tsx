import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { PolicyDetail, PolicyMarks } from './policyApi'
import { isCoverageExpired } from './policyStatus'
import { formatBps, formatUsd, findSelectedPortfolio } from './portfolioUtils'

interface PolicyMarksPanelProps {
  policy: PolicyDetail
  marksQuery: {
    data?: PolicyMarks
    isPending: boolean
    isError: boolean
    isFetching: boolean
    dataUpdatedAt: number
  }
  referenceTimeMs: number
}

function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function coverageLabel(marks: PolicyMarks): string | null {
  const c = marks.coverage
  if (!c || c.total <= 0) return null
  if (c.status === 'full') return `报价覆盖 ${c.quoted}/${c.total}`
  if (c.status === 'partial') return `部分报价 ${c.quoted}/${c.total}`
  return `无可用报价 0/${c.total}`
}

function nullPriceHint(reason: string | null | undefined): string {
  if (!reason) return '暂无报价'
  if (reason.startsWith('gamma_unreachable') || reason.startsWith('gamma_http')) {
    return '上游不可达'
  }
  if (reason === 'gamma_missing' || reason === 'gamma_no_markets') {
    return '市场无报价'
  }
  if (reason === 'side_unmapped') return '无法映射方向'
  if (reason === 'no_premium') return '缺少保费'
  return '暂无报价'
}

export function PolicyMarksPanel({ policy, marksQuery, referenceTimeMs }: PolicyMarksPanelProps) {
  const selected = findSelectedPortfolio(
    policy.portfolios,
    policy.selectedPortfolioId
  )
  const positions = selected?.positions ?? policy.portfolios[0]?.positions ?? []
  const marks = marksQuery.data

  if (marksQuery.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 p-4">
        <Spinner className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">加载实时行情…</span>
      </div>
    )
  }

  if (marksQuery.isError || !marks) {
    return (
      <div className="rounded-lg border border-border bg-secondary/20 p-4">
        <p className="text-sm text-muted-foreground">
          实时行情暂不可用（接口未就绪或网络异常）
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          仍可按入场价查看头寸明细；失败后将自动降频重试。
        </p>
      </div>
    )
  }

  const markByRef = new Map(marks.positions.map((m) => [m.marketRef, m]))
  const totalMark =
    marks.totalMarkValue ??
    (marks.coverage?.quoted
      ? marks.positions.reduce((sum, m) => sum + (m.markValue ?? 0), 0)
      : null)
  const fullHit =
    marks.fullHitPayout ??
    (policy.premium != null && selected?.expectedPayout != null
      ? selected.expectedPayout
      : null)
  const asOfLabel = formatAsOf(marks.asOf ?? marks.updatedAt)
  const covLabel = coverageLabel(marks)
  const showEmptyBanner =
    marks.coverage?.status === 'none' ||
    (marks.totalMarkValue == null && (marks.unavailableReason != null || marks.stale))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">实时行情</h3>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {marksQuery.isFetching && (
            <RefreshCw className="size-3 animate-spin" />
          )}
          {covLabel && <span>{covLabel}</span>}
          {marks.stale && (
            <span className="text-amber-400">行情可能过期</span>
          )}
          {marks.sharesRecomputed && (
            <span title="估值份额按当前费率重算，非链上份额">份额重算</span>
          )}
          {asOfLabel && <span>报价于 {asOfLabel}</span>}
          <span>每 30 秒刷新</span>
        </span>
      </div>

      {showEmptyBanner && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-[13px] font-medium text-amber-200">
              {marks.unavailableReason?.startsWith('gamma_')
                ? '上游行情暂不可用'
                : '暂无可用盯市报价'}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {marks.unavailableReason
                ? `原因：${marks.unavailableReason}。仍可按入场价查看头寸。`
                : '全部头寸均无有效报价；仍可按入场价查看头寸。'}
            </p>
          </div>
        </div>
      )}

      {marks.coverage?.status === 'partial' && !showEmptyBanner && (
        <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-[12px] text-muted-foreground">
          部分头寸缺少实时报价（{marks.coverage.quoted}/{marks.coverage.total}
          ），合计市值仅含已报价腿。
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            按市价浮动价值
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-primary">
            {totalMark != null ? formatUsd(totalMark) : '—'}
          </p>
        </div>
        {fullHit != null && (
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              若现在全部命中
            </p>
            <p className="mt-1 font-mono text-lg font-semibold text-emerald-400">
              {formatUsd(fullHit)}
            </p>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">头寸</th>
              <th className="px-3 py-2 text-right font-medium">入场价</th>
              <th className="px-3 py-2 text-right font-medium">现价</th>
              <th className="px-3 py-2 text-right font-medium">市值</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const mark = markByRef.get(pos.marketRef)
              const currentBps = mark?.currentPriceBps
              const moved =
                currentBps != null &&
                Math.abs(currentBps - pos.entryPriceBps) > 200
              const unquoted = currentBps == null
              return (
                <tr
                  key={pos.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'mr-1.5 rounded px-1 py-0.5 text-[10px] font-semibold',
                        pos.side === 'YES'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-rose-500/15 text-rose-400'
                      )}
                    >
                      {pos.side}
                    </span>
                    <span className="line-clamp-2 text-foreground">
                      {pos.question}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {formatBps(pos.entryPriceBps)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right',
                      unquoted
                        ? 'text-muted-foreground'
                        : moved
                          ? 'text-amber-400'
                          : 'text-foreground'
                    )}
                    title={
                      unquoted
                        ? nullPriceHint(mark?.nullPriceReason)
                        : undefined
                    }
                  >
                    {currentBps != null
                      ? formatBps(currentBps)
                      : nullPriceHint(mark?.nullPriceReason)}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">
                    {mark?.markValue != null
                      ? formatUsd(mark.markValue)
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {policy.coverageEnd &&
        isCoverageExpired(policy.coverageEnd, referenceTimeMs) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-[13px] font-medium text-amber-200">
                等待预言机结算
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                保障期已结束，结算结果将在预言机确认后更新。盯市价不等于结算结果。
              </p>
            </div>
          </div>
        )}
    </div>
  )
}
