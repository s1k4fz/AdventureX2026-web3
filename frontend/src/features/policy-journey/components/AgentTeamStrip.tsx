import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  TriangleAlert,
  XCircle,
} from 'lucide-react'

import { elapsedLabel, itemCount } from '@/features/agent/subagentBrief'
import {
  CJK_SCRAMBLE_CHARS,
  DecryptedText,
} from '@/components/DecryptedText'
import {
  INTEL_SUBAGENT_KINDS,
  PERMISSION_LABELS,
  getSubagentIdentity,
} from '@/features/agent/subagentIdentity'
import {
  SUBAGENT_KIND_ORDER,
  SUBAGENT_STATUS_LABELS,
  type AgentSubagent,
  type AgentSubagentKind,
  type AgentSubagentStatus,
} from '@/features/agent/types'
import { cn } from '@/lib/utils'

function isTerminal(status: AgentSubagentStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'skipped'
}

function chipStatusIcon(status: AgentSubagentStatus) {
  if (status === 'succeeded') {
    return <CheckCircle2 className="size-3 text-[var(--units-green)]" />
  }
  if (status === 'failed') {
    return <XCircle className="size-3 text-destructive" />
  }
  if (status === 'running') {
    return <Loader2 className="size-3 animate-spin text-[var(--units-orange)]" />
  }
  if (status === 'skipped') {
    return <CircleDashed className="size-3 text-muted-foreground/60" />
  }
  return (
    <span className="size-1.5 rounded-full bg-[color-mix(in_srgb,var(--units-black)_22%,transparent)]" />
  )
}

/** Single shared 1s ticker so running-elapsed labels stay live without per-chip timers. */
function useTeamTicker(active: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [active])
}

function TeamChip({
  kind,
  row,
  index,
}: {
  kind: AgentSubagentKind
  row?: AgentSubagent
  index: number
}) {
  const identity = getSubagentIdentity(kind)
  const status = row?.status ?? 'pending'
  const count = itemCount(row)
  const elapsed =
    status === 'running' && row
      ? elapsedLabel({ ...row, finishedAt: null })
      : null

  return (
    <li
      className={cn(
        'units-stagger flex min-w-0 items-center gap-1.5 rounded-full border bg-background py-1 pl-1 pr-2.5 transition-colors duration-300 units-ease motion-reduce:transition-none',
        status === 'running'
          ? 'border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)]'
          : status === 'failed'
            ? 'border-[color-mix(in_srgb,var(--units-black)_10%,transparent)]'
            : 'border-[var(--units-stroke-color)]',
        (status === 'pending' || status === 'skipped') && 'opacity-60'
      )}
      style={{ animationDelay: `${index * 40}ms` }}
      title={`${identity.alias} · ${identity.role} · ${SUBAGENT_STATUS_LABELS[status]} · ${PERMISSION_LABELS[identity.permission]}`}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
        style={{
          background: `color-mix(in srgb, ${identity.accent} 88%, transparent)`,
          color: 'var(--units-brand-plate)',
        }}
        aria-hidden
      >
        {identity.monogram}
      </span>
      <span className="truncate text-[12px] font-medium text-foreground">
        {identity.alias}
      </span>
      {chipStatusIcon(status)}
      {count > 0 ? (
        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
          {count} 条
        </span>
      ) : null}
      {elapsed ? (
        <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
          {elapsed}
        </span>
      ) : null}
    </li>
  )
}

export interface AgentTeamStripProps {
  subagents?: AgentSubagent[]
  /** Opens the technical detail section below the strip. */
  onOpenDetails?: () => void
  /**
   * 左轨常驻形态：只渲染头像堆 + 汇总行，让非检索阶段也有
   * Agent 在场感；详情仍靠 title 提示与检索阶段的完整泳道。
   */
  compact?: boolean
  className?: string
}

/**
 * Always-visible compact multi-agent status strip: one chip per investigator
 * with live status, evidence count and running-elapsed. Renders pending chips
 * before any SSE data arrives so the team is visible from second zero.
 */
export function AgentTeamStrip({
  subagents = [],
  onOpenDetails,
  compact = false,
  className,
}: AgentTeamStripProps) {
  const byKind = new Map(subagents.map((row) => [row.kind, row]))
  const statuses = SUBAGENT_KIND_ORDER.map(
    (kind) => byKind.get(kind)?.status ?? 'pending'
  )
  const running = statuses.filter((s) => s === 'running').length
  const done = statuses.filter(isTerminal).length
  const total = SUBAGENT_KIND_ORDER.length

  useTeamTicker(running > 0)

  const intelStatuses = INTEL_SUBAGENT_KINDS.map(
    (kind) => byKind.get(kind)?.status ?? 'pending'
  )
  // Edge case: every intel lane failed — the plan will rest on market data only.
  const allIntelFailed =
    intelStatuses.length > 0 && intelStatuses.every((s) => s === 'failed')

  const summary =
    done >= total
      ? `全员完成 · ${done}/${total}`
      : running > 0
        ? `进行中 ${running} · 完成 ${done}/${total}`
        : done > 0
          ? `完成 ${done}/${total}`
          : '调查员待命，等待主理人派发'

  if (compact) {
    return (
      <section
        className={cn(
          'rounded-xl border border-[var(--units-stroke-color)] bg-background px-2.5 py-2',
          className
        )}
        aria-label="多Agent 调查团队"
      >
        <p className="text-[11px] font-semibold text-muted-foreground">
          调查团队
          <span className="ml-1.5 font-normal tabular-nums">{summary}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-1">
          {SUBAGENT_KIND_ORDER.map((kind) => {
            const identity = getSubagentIdentity(kind)
            const status = byKind.get(kind)?.status ?? 'pending'
            return (
              <span
                key={kind}
                className={cn(
                  'relative flex size-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold',
                  (status === 'pending' || status === 'skipped') &&
                    'opacity-45'
                )}
                style={{
                  background: `color-mix(in srgb, ${identity.accent} 88%, transparent)`,
                  color: 'var(--units-brand-plate)',
                }}
                title={`${identity.alias} · ${SUBAGENT_STATUS_LABELS[status]} · ${PERMISSION_LABELS[identity.permission]}`}
              >
                {identity.monogram}
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-background',
                    status === 'succeeded'
                      ? 'bg-[var(--units-green)]'
                      : status === 'failed'
                        ? 'bg-destructive'
                        : status === 'running'
                          ? 'animate-pulse bg-[var(--units-orange)]'
                          : 'bg-[color-mix(in_srgb,var(--units-black)_22%,transparent)]'
                  )}
                  aria-hidden
                />
              </span>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-[var(--units-stroke-color)] bg-background px-3.5 py-3',
        className
      )}
      aria-label="多Agent 调查团队"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[12.5px] font-semibold text-foreground">
          调查团队
          <span className="ml-2 font-normal tabular-nums text-muted-foreground">
            {done >= total ? (
              summary
            ) : (
              <DecryptedText
                text={summary}
                animateOn="view"
                sequential
                speed={26}
                characters={CJK_SCRAMBLE_CHARS}
                encryptedClassName="opacity-60"
              />
            )}
          </span>
        </p>
        {onOpenDetails ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none"
            onClick={onOpenDetails}
          >
            查看细节
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {SUBAGENT_KIND_ORDER.map((kind, index) => (
          <TeamChip
            key={kind}
            kind={kind}
            row={byKind.get(kind)}
            index={index}
          />
        ))}
      </ul>
      {allIntelFailed ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--units-orange)]" />
          辅助情报源全部失败，方案将仅基于市场数据推导；不影响流程继续。
        </p>
      ) : null}
    </section>
  )
}
