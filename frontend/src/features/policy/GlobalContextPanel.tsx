import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Globe2,
  Link2,
  Newspaper,
  RefreshCw,
  TrendingUp,
  Waves,
} from 'lucide-react'

import { PixelArt } from '@/components/pixel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useWorldContextQuery,
  type RiskFactorCategory,
  type WorldContext,
  type WorldSignal,
} from './policyApi'

const FRESHNESS_LABEL: Record<WorldContext['freshness'], string> = {
  fresh: '实时',
  stale: '缓存',
  degraded: '降级',
  unavailable: '不可用',
}

const SOURCE_LABEL: Record<WorldContext['source'], string> = {
  live: 'Live API',
  health_only: '仅健康检查',
  cache: '本地缓存',
  unavailable: '无数据',
}

const KIND_META: Record<
  WorldSignal['kind'],
  { label: string; meaning: string; Icon: typeof Activity }
> = {
  sentiment: {
    label: '情绪',
    meaning: '市场风险偏好与恐慌/贪婪温度',
    Icon: Waves,
  },
  risk: {
    label: '地缘风险',
    meaning: '区域冲突与战略风险评分，影响事件赔付概率',
    Icon: AlertTriangle,
  },
  macro: {
    label: '宏观报价',
    meaning: '利率/商品/指数等宏观锚点，校准保费与波动假设',
    Icon: TrendingUp,
  },
  prediction: {
    label: '预测市场',
    meaning: '外部概率参考，可与 Polymarket 候选交叉验证',
    Icon: Activity,
  },
  news: {
    label: '情报洞察',
    meaning: '近期事件摘要，用于解释组合暴露的叙事背景',
    Icon: Newspaper,
  },
  health: {
    label: '管道健康',
    meaning: 'WorldMonitor 数据管道可用性',
    Icon: Activity,
  },
}

function formatFetchedAt(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (deltaSec < 60) return `${deltaSec}s 前`
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} 分钟前`
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)} 小时前`
  return new Date(t).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fearGreedTone(value: number): string {
  if (value <= 25) return '极度恐慌 · 保费偏保守'
  if (value <= 45) return '偏恐慌 · 关注下行尾部'
  if (value <= 55) return '中性 · 均衡档较稳妥'
  if (value <= 75) return '偏贪婪 · 注意过热回撤'
  return '极度贪婪 · 进取档波动放大'
}

function FreshnessBadge({ freshness }: { freshness: WorldContext['freshness'] }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        freshness === 'fresh' &&
          'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] text-[var(--units-green)]',
        freshness === 'stale' &&
          'border-[color-mix(in_srgb,var(--units-yellow)_45%,transparent)] bg-[color-mix(in_srgb,var(--units-yellow)_14%,transparent)] text-foreground',
        freshness === 'degraded' &&
          'border-[color-mix(in_srgb,var(--units-orange)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] text-[var(--units-orange)]',
        freshness === 'unavailable' &&
          'border-border bg-secondary/40 text-muted-foreground'
      )}
    >
      {FRESHNESS_LABEL[freshness]}
    </span>
  )
}

function FearGreedMeter({
  value,
  label,
}: {
  value: number
  label: string | null
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="rounded-xl border border-border bg-secondary/15 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Fear & Greed
        </p>
        <p className="text-[11px] text-muted-foreground">
          {label || fearGreedTone(clamped)}
        </p>
      </div>
      <p className="mt-1 font-display text-[22px] font-semibold leading-none text-foreground">
        {clamped}
        <span className="ml-1 text-[12px] font-normal text-muted-foreground">
          /100
        </span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_10%,transparent)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--units-blue),var(--units-green),var(--units-orange))] transition-[width] duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {fearGreedTone(clamped)} — 用于校准三档组合的风险偏好权重。
      </p>
    </div>
  )
}

interface ScoredSignal {
  signal: WorldSignal
  score: number
  matchedFactors: RiskFactorCategory[]
}

function correlateSignals(
  signals: WorldSignal[],
  factors?: RiskFactorCategory[]
): ScoredSignal[] {
  const list = signals.map((signal) => ({
    signal,
    score: 0,
    matchedFactors: [] as RiskFactorCategory[],
  }))

  if (!factors?.length) {
    return list.slice(0, 10)
  }

  for (const row of list) {
    const hay =
      `${row.signal.label} ${row.signal.detail ?? ''} ${row.signal.region ?? ''} ${row.signal.kind}`.toLowerCase()
    for (const factor of factors) {
      const tokens = [factor.id, factor.label, factor.rationale ?? '']
        .join(' ')
        .toLowerCase()
        .split(/[\s,/|·\-_+]+/)
        .filter((t) => t.length > 1)
      let hit = 0
      for (const token of tokens) {
        if (hay.includes(token)) hit += 1
      }
      if (hit > 0) {
        row.score += hit
        row.matchedFactors.push(factor)
      }
    }
  }

  list.sort((a, b) => b.score - a.score || (b.signal.score ?? 0) - (a.signal.score ?? 0))
  return list.slice(0, 10)
}

function SignalCard({
  row,
  expanded,
  onToggle,
}: {
  row: ScoredSignal
  expanded: boolean
  onToggle: () => void
}) {
  const { signal, matchedFactors, score } = row
  const meta = KIND_META[signal.kind]
  const Icon = meta.Icon
  const hasScore = typeof signal.score === 'number'

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'units-stage-enter flex w-full flex-col gap-1.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
        score > 0
          ? 'border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_8%,var(--units-soft))]'
          : 'border-border bg-[var(--units-soft)] hover:border-[var(--units-stroke-strong)]'
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        <span>{meta.label}</span>
        {signal.trend && <span>· {signal.trend}</span>}
        {signal.region && <span>· {signal.region}</span>}
        {score > 0 && (
          <span className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--units-orange)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold text-foreground normal-case tracking-normal">
            关联保单 ×{score}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-[12px] font-medium leading-4 text-foreground">
        {signal.label}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-foreground">{signal.value}</p>
        {hasScore && (
          <div className="h-1 w-14 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-[var(--units-orange)]"
              style={{
                width: `${Math.max(6, Math.min(100, signal.score ?? 0))}%`,
              }}
            />
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-1 space-y-1.5 border-t border-border/60 pt-1.5 text-[11px] leading-4 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground/80">信号含义：</span>
            {meta.meaning}
          </p>
          {signal.detail ? (
            <p>
              <span className="font-medium text-foreground/80">细节：</span>
              {signal.detail}
            </p>
          ) : null}
          {matchedFactors.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1">
              <Link2 className="size-3 shrink-0" />
              <span className="font-medium text-foreground/80">对应风险因子：</span>
              {matchedFactors.map((f) => (
                <span
                  key={f.id}
                  title={f.rationale}
                  className="rounded-full border border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-foreground"
                >
                  {f.label}
                </span>
              ))}
            </p>
          ) : (
            <p>与当前保单因子弱相关，作宏观背景参考。</p>
          )}
          <p className="text-[10px] opacity-80">来源 {signal.source ?? 'worldmonitor'}</p>
        </div>
      )}
    </button>
  )
}

export function GlobalContextPanel({
  factorCategories,
  className,
}: {
  factorCategories?: RiskFactorCategory[]
  className?: string
}) {
  const query = useWorldContextQuery()
  const data = query.data
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const correlated = useMemo(
    () => (data ? correlateSignals(data.signals, factorCategories) : []),
    [data, factorCategories]
  )

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<WorldSignal['kind'], number>> = {}
    for (const row of correlated) {
      counts[row.signal.kind] = (counts[row.signal.kind] ?? 0) + 1
    }
    return counts
  }, [correlated])

  if (query.isPending) {
    return (
      <section
        className={cn(
          'units-stage-enter relative overflow-hidden rounded-2xl border border-border bg-card p-4',
          className
        )}
        aria-busy="true"
      >
        <div className="relative flex items-center gap-3">
          <PixelArt
            pattern="people"
            animate
            size="xs"
            label="加载全球情报"
            className="shrink-0 rounded-sm"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Globe2 className="size-4 text-[var(--units-blue)]" />
              <h3 className="text-[14px] font-semibold">全球情报关联</h3>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              正在拉取 WorldMonitor 快照…
            </p>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl units-skeleton-shimmer" />
          ))}
        </div>
      </section>
    )
  }

  if (!data) {
    return null
  }

  const linkedCount = correlated.filter((r) => r.score > 0).length

  return (
    <section
      className={cn(
        'units-stage-enter rounded-2xl border border-border bg-card p-4',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Globe2 className="size-4 text-[var(--units-blue)]" />
        <h3 className="text-[14px] font-semibold text-foreground">
          全球情报关联
        </h3>
        <FreshnessBadge freshness={data.freshness} />
        <span className="text-[11px] text-muted-foreground">
          {SOURCE_LABEL[data.source]} · {formatFetchedAt(data.fetchedAt)}
        </span>
        {data.healthStatus && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            管道 {data.healthStatus}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto rounded-full"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={cn('size-3.5', query.isFetching && 'animate-spin')}
          />
          刷新
        </Button>
      </div>

      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
        {data.summary ||
          'WorldMonitor 全球信号与保单风险因子的关联视图 — 点击信号展开含义与因子映射。'}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {data.fearGreed != null ? (
          <FearGreedMeter
            value={data.fearGreed}
            label={data.fearGreedLabel}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border px-3 py-2.5 text-[12px] text-muted-foreground">
            暂无 Fear & Greed。配置 API Key 后可校准组合风险偏好。
          </div>
        )}

        <div className="rounded-xl border border-border bg-secondary/10 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            与保单 / 头寸的关联
          </p>
          {factorCategories && factorCategories.length > 0 ? (
            <>
              <p className="mt-1 text-[12px] leading-5 text-foreground">
                已识别{' '}
                <span className="font-semibold">{factorCategories.length}</span>{' '}
                类风险因子；本快照中{' '}
                <span className="font-semibold text-[var(--units-orange)]">
                  {linkedCount}
                </span>{' '}
                条信号与因子直接相关，编排时应优先对齐这些暴露。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {factorCategories.map((f) => (
                  <span
                    key={f.id}
                    title={f.rationale}
                    className="rounded-full border border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium"
                  >
                    {f.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              完成问卷后将显示风险因子与全球信号的交叉映射，用于解释三档头寸权重。
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {Object.entries(kindCounts).map(([kind, count]) => (
              <span
                key={kind}
                className="rounded-full border border-border px-2 py-0.5"
              >
                {KIND_META[kind as WorldSignal['kind']]?.label ?? kind} {count}
              </span>
            ))}
          </div>
        </div>
      </div>

      {correlated.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {correlated.map((row) => (
            <SignalCard
              key={row.signal.id}
              row={row}
              expanded={expandedId === row.signal.id}
              onToggle={() =>
                setExpandedId((cur) =>
                  cur === row.signal.id ? null : row.signal.id
                )
              }
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {data.error ??
            '暂无详细全球信号。配置 WORLDMONITOR_API_KEY 后可拉取情绪、风险与宏观快照。'}
        </p>
      )}

      {data.topRisks.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            高风险区域（影响事件类头寸赔付路径）
          </p>
          <div className="flex flex-col gap-1.5">
            {data.topRisks.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/20 px-2.5 py-1.5 text-[11px]"
              >
                <AlertTriangle className="size-3 shrink-0 text-[var(--units-orange)]" />
                <span className="font-medium text-foreground">{r.label}</span>
                <span className="text-muted-foreground">{r.value}</span>
                {r.detail && (
                  <span className="text-muted-foreground">· {r.detail}</span>
                )}
                {r.trend && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    趋势 {r.trend}
                  </span>
                )}
                {typeof r.score === 'number' && (
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-[var(--units-orange)]"
                      style={{ width: `${Math.min(100, r.score)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.error && data.signals.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">{data.error}</p>
      )}
    </section>
  )
}
