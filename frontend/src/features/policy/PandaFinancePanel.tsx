import { useMemo } from 'react'
import {
  CandlestickChart,
  Fuel,
  Landmark,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  usePandaContextQuery,
  type PandaContext,
  type PandaSignal,
} from './policyApi'
import { usePandaModulesPreference } from './usePandaModulesPreference'

const FRESHNESS_LABEL: Record<string, string> = {
  fresh: '实时',
  stale: '偏旧',
  old: '过期',
  unknown: '未知',
  'n/a': '—',
}

const KIND_META: Record<
  string,
  { label: string; Icon: typeof TrendingUp; tone: string }
> = {
  index: {
    label: '指数',
    Icon: CandlestickChart,
    tone: 'var(--units-blue)',
  },
  futures: {
    label: '期货',
    Icon: TrendingUp,
    tone: 'var(--units-orange)',
  },
  macro: {
    label: '宏观',
    Icon: Landmark,
    tone: 'var(--units-green)',
  },
  energy: {
    label: '能源',
    Icon: Fuel,
    tone: 'var(--units-yellow)',
  },
  fx: {
    label: '外汇',
    Icon: Landmark,
    tone: 'var(--units-lilac)',
  },
}

function FreshnessBadge({ freshness }: { freshness: string }) {
  const label = FRESHNESS_LABEL[freshness] ?? freshness
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        freshness === 'fresh' &&
          'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] text-[var(--units-green)]',
        freshness === 'stale' &&
          'border-[color-mix(in_srgb,var(--units-yellow)_45%,transparent)] bg-[color-mix(in_srgb,var(--units-yellow)_14%,transparent)] text-foreground',
        (freshness === 'old' || freshness === 'unavailable') &&
          'border-border bg-secondary/40 text-muted-foreground'
      )}
    >
      {label}
    </span>
  )
}

function SignalChip({ signal }: { signal: PandaSignal }) {
  const meta = KIND_META[signal.kind] ?? {
    label: signal.kind,
    Icon: TrendingUp,
    tone: 'var(--units-black)',
  }
  const Icon = meta.Icon
  return (
    <li className="rounded-xl border border-[var(--units-stroke-color)] bg-background/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon className="size-3" style={{ color: meta.tone }} />
        {meta.label}
        {signal.asOf ? (
          <span className="ml-auto tabular-nums">{signal.asOf}</span>
        ) : null}
      </div>
      <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
        {signal.label}
      </p>
      <p className="mt-0.5 text-[13px] tabular-nums text-foreground/90">
        {signal.value}
      </p>
      {signal.detail ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{signal.detail}</p>
      ) : null}
    </li>
  )
}

function groupSignals(signals: PandaSignal[]) {
  const order = ['index', 'futures', 'macro', 'energy', 'fx']
  const map = new Map<string, PandaSignal[]>()
  for (const sig of signals) {
    const list = map.get(sig.kind) ?? []
    list.push(sig)
    map.set(sig.kind, list)
  }
  return order
    .filter((k) => map.has(k))
    .map((k) => ({ kind: k, items: map.get(k)! }))
}

export function PandaFinancePanel({ className }: { className?: string }) {
  const { modules } = usePandaModulesPreference()
  const query = usePandaContextQuery(modules)
  const data = query.data

  const groups = useMemo(
    () => (data?.signals ? groupSignals(data.signals) : []),
    [data?.signals]
  )

  if (query.isPending) {
    return (
      <section
        className={cn(
          'units-stage-enter rounded-2xl border border-[var(--units-stroke-color)] bg-card p-4',
          className
        )}
        aria-busy="true"
      >
        <div className="flex items-center gap-2">
          <CandlestickChart className="size-4 text-[var(--units-orange)]" />
          <h3 className="text-[14px] font-semibold">量数金融</h3>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          正在拉取 PandaAI 快照…
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl units-skeleton-shimmer" />
          ))}
        </div>
      </section>
    )
  }

  if (!data) return null

  return (
    <PandaFinancePanelView
      data={data}
      groups={groups}
      fetching={query.isFetching}
      onRefresh={() => void query.refetch()}
      className={className}
    />
  )
}

function PandaFinancePanelView({
  data,
  groups,
  fetching,
  onRefresh,
  className,
}: {
  data: PandaContext
  groups: Array<{ kind: string; items: PandaSignal[] }>
  fetching: boolean
  onRefresh: () => void
  className?: string
}) {
  if (data.source === 'disabled') {
    return (
      <section
        className={cn(
          'units-stage-enter rounded-2xl border border-[var(--units-stroke-color)] bg-card p-4',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <CandlestickChart className="size-4 text-muted-foreground" />
          <h3 className="text-[14px] font-semibold">量数金融</h3>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            未启用
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
          服务端未开启 PandaAI（检查
          <code className="mx-1 rounded bg-secondary px-1">PANDAAI_ENABLED</code>
          与账号配置）。可在设置 → 数据源调整展示模块。
        </p>
      </section>
    )
  }

  if (data.source !== 'pandaai') {
    return (
      <section
        className={cn(
          'units-stage-enter rounded-2xl border border-[var(--units-stroke-color)] bg-card p-4',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <CandlestickChart className="size-4 text-[var(--units-orange)]" />
          <h3 className="text-[14px] font-semibold">量数金融</h3>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            不可用
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto rounded-full"
            onClick={onRefresh}
            disabled={fetching}
          >
            <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
            重试
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {data.error || 'PandaAI 暂无可用快照'}
        </p>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'units-stage-enter rounded-2xl border border-[var(--units-stroke-color)] bg-card p-4',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CandlestickChart className="size-4 text-[var(--units-orange)]" />
        <h3 className="text-[14px] font-semibold text-foreground">量数金融</h3>
        <FreshnessBadge freshness={data.freshness} />
        {data.lastTradeDate ? (
          <span className="text-[11px] text-muted-foreground">
            交易日 {data.lastTradeDate}
          </span>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {data.signals.length} 条 · PandaAI
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto rounded-full"
          onClick={onRefresh}
          disabled={fetching}
        >
          <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
          刷新
        </Button>
      </div>

      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
        {data.summary ||
          'PandaAI 精选金融信号，用于校准保费与宏观暴露假设。'}
      </p>

      {groups.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          当前未选择数据集，请到设置 → 数据源开启模块。
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={group.kind}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {KIND_META[group.kind]?.label ?? group.kind}
              </p>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((sig) => (
                  <SignalChip
                    key={`${sig.kind}-${sig.symbol || sig.label}`}
                    signal={sig}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
