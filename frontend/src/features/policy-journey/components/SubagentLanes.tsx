import { useEffect, useState } from 'react'

import { SubagentBadge } from '@/features/agent/components/SubagentBadge'
import {
  attemptList,
  briefSummary,
  citationList,
  elapsedLabel,
  fallbackLabel,
  itemCount,
  latencyLabel,
  progressPhaseLabel,
  providerLabel,
  querySnippet,
} from '@/features/agent/subagentBrief'
import { getSubagentIdentity } from '@/features/agent/subagentIdentity'
import {
  INTEL_PROVIDER_LABELS,
  SUBAGENT_KIND_ORDER,
  SUBAGENT_STATUS_LABELS,
  type AgentSubagent,
  type AgentSubagentKind,
} from '@/features/agent/types'
import { cn } from '@/lib/utils'

function useLiveElapsed(
  startedAt?: string | null,
  finishedAt?: string | null
): string | null {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!startedAt || finishedAt) return undefined
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [startedAt, finishedAt])

  return elapsedLabel({
    id: '',
    kind: 'polymarket',
    status: finishedAt ? 'succeeded' : 'running',
    startedAt,
    finishedAt,
    createdAt: startedAt ?? '',
  })
}

function LaneRow({
  kind,
  row,
  index,
  isOpen,
  onToggle,
}: {
  kind: AgentSubagentKind
  row?: AgentSubagent
  index: number
  isOpen: boolean
  onToggle: () => void
}) {
  const status = row?.status ?? 'pending'
  const identity = getSubagentIdentity(kind)
  const summary = briefSummary(row)
  const phase = progressPhaseLabel(row)
  const count = itemCount(row)
  const citations = citationList(row)
  const attempts = attemptList(row)
  const provider = providerLabel(row)
  const fallback = fallbackLabel(row)
  const latency = latencyLabel(row)
  const query = querySnippet(row)
  const errorText = row?.errorMessage
  const elapsed = useLiveElapsed(row?.startedAt, row?.finishedAt)

  return (
    <li
      className="units-stage-enter rounded-xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_40%,transparent)] px-3 py-2.5"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 text-left"
        onClick={onToggle}
      >
        <SubagentBadge
          kind={kind}
          status={status}
          size="md"
          showRole={false}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {identity.role}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {SUBAGENT_STATUS_LABELS[status]}
            </span>
            {count > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {count} 条证据
              </span>
            ) : null}
            {elapsed ? (
              <span className="text-[11px] text-muted-foreground">
                {elapsed}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {phase && status === 'running' ? phase : summary || '—'}
          </span>
          {query ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              查询 · {query}
            </span>
          ) : null}
          {(provider || fallback || latency) && (
            <span className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium text-muted-foreground">
              {provider ? (
                <span className="rounded-md border border-[var(--units-stroke-color)] bg-background/70 px-1.5 py-0.5">
                  {provider}
                </span>
              ) : null}
              {fallback ? (
                <span className="rounded-md border border-[var(--units-stroke-color)] px-1.5 py-0.5">
                  降级自 {fallback}
                </span>
              ) : null}
              {latency ? (
                <span className="rounded-md border border-[var(--units-stroke-color)] px-1.5 py-0.5">
                  {latency}
                </span>
              ) : null}
            </span>
          )}
          {status === 'failed' && errorText ? (
            <span className="mt-1 block line-clamp-2 text-[11px] text-destructive">
              {errorText}
            </span>
          ) : null}
        </span>
      </button>
      {isOpen ? (
        <div className="mt-2 space-y-2 border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] pt-2 pl-1">
          {attempts.length > 0 ? (
            <ul className="space-y-1 pl-2">
              <li className="text-[11px] font-semibold text-muted-foreground">
                检索尝试
              </li>
              {attempts.map((attempt, i) => {
                const name =
                  typeof attempt.provider === 'string'
                    ? (INTEL_PROVIDER_LABELS[attempt.provider] ??
                      attempt.provider)
                    : `尝试 ${i + 1}`
                return (
                  <li
                    key={`${kind}-attempt-${i}`}
                    className="text-[12px] text-muted-foreground"
                  >
                    {name}
                    {attempt.ok === false
                      ? ' · 失败'
                      : attempt.skipped
                        ? ' · 跳过'
                        : ' · 成功'}
                    {typeof attempt.count === 'number'
                      ? ` · ${attempt.count} 条`
                      : ''}
                    {attempt.error ? ` · ${attempt.error}` : ''}
                  </li>
                )
              })}
            </ul>
          ) : null}
          {citations.length > 0 ? (
            <ul className="space-y-1 pl-2">
              <li className="text-[11px] font-semibold text-muted-foreground">
                引用
              </li>
              {citations.slice(0, 6).map((cite, i) => (
                <li
                  key={`${kind}-cite-${i}`}
                  className="text-[12px] leading-snug text-muted-foreground"
                >
                  {cite.url ? (
                    <a
                      href={cite.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {cite.title || cite.url}
                    </a>
                  ) : (
                    <span className="text-foreground">
                      {cite.title || '引用'}
                    </span>
                  )}
                  {cite.snippet ? (
                    <span className="mt-0.5 block line-clamp-2">
                      {cite.snippet}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="pl-2 text-[12px] text-muted-foreground">
              暂无引用细节
            </p>
          )}
        </div>
      ) : null}
    </li>
  )
}

export function SubagentLanes({
  subagents = [],
  showHeading = true,
  className,
}: {
  subagents?: AgentSubagent[]
  /** Off when rendered inside a section that already has its own label. */
  showHeading?: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState<AgentSubagentKind | null>(null)
  const byKind = new Map(subagents.map((row) => [row.kind, row]))

  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      aria-label="多源情报采集"
    >
      {showHeading ? (
        <p className="text-[12.5px] font-medium text-muted-foreground">
          调查员泳道
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {SUBAGENT_KIND_ORDER.map((kind, index) => (
          <LaneRow
            key={kind}
            kind={kind}
            row={byKind.get(kind)}
            index={index}
            isOpen={expanded === kind}
            onToggle={() =>
              setExpanded((prev) => (prev === kind ? null : kind))
            }
          />
        ))}
      </ul>
    </div>
  )
}

export function subagentProgressLabel(subagents: AgentSubagent[]): string | null {
  if (!subagents.length) return null
  const done = subagents.filter((row) =>
    ['succeeded', 'failed', 'skipped'].includes(row.status)
  ).length
  const total = Math.max(subagents.length, SUBAGENT_KIND_ORDER.length)
  const running = subagents.filter((row) => row.status === 'running').length
  if (running > 0) return `采集中 · ${done}/${total}`
  if (done >= total) return `采集完成 · ${done}/${total}`
  return `采集中 · ${done}/${total}`
}

/** Compact avatar strip for the questionnaire's background-collect line. */
export function SubagentCollectHint({
  subagents,
}: {
  subagents: AgentSubagent[]
}) {
  const label = subagentProgressLabel(subagents)
  if (!label) return null
  const byKind = new Map(subagents.map((row) => [row.kind, row]))
  const active = SUBAGENT_KIND_ORDER.filter((kind) => {
    const status = byKind.get(kind)?.status
    return status === 'running' || status === 'succeeded' || status === 'failed'
  }).slice(0, 4)

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
        {label}
      </span>
      {active.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {active.map((kind) => {
            const status = byKind.get(kind)?.status ?? 'pending'
            const identity = getSubagentIdentity(kind)
            return (
              <span
                key={kind}
                title={`${identity.alias} · ${SUBAGENT_STATUS_LABELS[status]}`}
                className="inline-flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-[var(--units-brand-plate)]"
                style={{
                  background: `color-mix(in srgb, ${identity.accent} 88%, transparent)`,
                  opacity: status === 'running' ? 1 : 0.7,
                }}
              >
                {identity.monogram}
              </span>
            )
          })}
        </span>
      ) : null}
    </span>
  )
}
