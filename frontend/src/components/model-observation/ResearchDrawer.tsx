import { useEffect, useId, useState } from 'react'
import { FlaskConical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatActivitiesAsReasoning } from '@/features/agent/activitySummaries'
import {
  briefSummary,
  citationList,
  fallbackLabel,
  itemCount,
  latencyLabel,
  providerLabel,
} from '@/features/agent/subagentBrief'
import { SubagentBadge } from '@/features/agent/components/SubagentBadge'
import type { AgentActivityItem, AgentSubagent } from '@/features/agent/types'
import {
  SUBAGENT_STATUS_LABELS,
  type AgentSubagentStatus,
} from '@/features/agent/types'
import { ConversationReasoning } from '@/features/conversation/ConversationReasoning'
import type { ModelExplanation } from '@/features/policy-journey/types'
import { cn } from '@/lib/utils'

import { ModelObservationCard } from './ModelObservationCard'
import { ModelTrace } from './ModelTrace'
import { useModelObservation } from './useModelObservation'

export interface ResearchDrawerProps {
  explanations: ModelExplanation[]
  activities?: AgentActivityItem[]
  subagents?: AgentSubagent[]
  /** Streamed / accumulated model reasoning body (CoT). */
  reasoningText?: string
  isReasoningStreaming?: boolean
  className?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onAction?: (explanation: ModelExplanation) => void
}

function reasoningFromActivities(activities: AgentActivityItem[]): string {
  return formatActivitiesAsReasoning(activities)
}

function statusTone(status: AgentSubagentStatus): string {
  if (status === 'succeeded') return 'text-[var(--units-green)]'
  if (status === 'failed') return 'text-destructive'
  if (status === 'running') return 'text-[var(--units-orange)]'
  return 'text-muted-foreground'
}

function SubagentTimeline({ subagents }: { subagents: AgentSubagent[] }) {
  if (!subagents.length) return null
  const ordered = subagents
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[12px] font-semibold text-muted-foreground">
        调查员时间线
      </p>
      <ol className="flex flex-col gap-1.5">
        {ordered.map((row) => {
          const summary = briefSummary(row) || row.status
          const statusLabel =
            SUBAGENT_STATUS_LABELS[row.status] ?? row.status
          const provider = providerLabel(row)
          const fallback = fallbackLabel(row)
          const latency = latencyLabel(row)
          const count = itemCount(row)
          const citations = citationList(row).slice(0, 4)
          const errorText =
            row.errorMessage ||
            (typeof row.brief?.errorMessage === 'string'
              ? row.brief.errorMessage
              : typeof row.brief?.error_message === 'string'
                ? row.brief.error_message
                : null)

          return (
            <li
              key={row.id}
              className="rounded-xl border border-[var(--units-stroke-color)] bg-background px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <SubagentBadge
                  kind={row.kind}
                  status={row.status}
                  size="sm"
                  showRole={false}
                />
                <span
                  className={cn(
                    'text-[11px] font-semibold',
                    statusTone(row.status)
                  )}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
                {summary}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                {provider ? (
                  <span className="rounded-md border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] px-1.5 py-0.5">
                    {provider}
                  </span>
                ) : null}
                {fallback ? (
                  <span className="rounded-md border border-[var(--units-stroke-color)] px-1.5 py-0.5">
                    降级自 {fallback}
                  </span>
                ) : null}
                {count > 0 ? (
                  <span className="rounded-md border border-[var(--units-stroke-color)] px-1.5 py-0.5">
                    {count} 条
                  </span>
                ) : null}
                {latency ? (
                  <span className="rounded-md border border-[var(--units-stroke-color)] px-1.5 py-0.5">
                    {latency}
                  </span>
                ) : null}
              </div>
              {row.status === 'failed' && errorText ? (
                <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
                  {errorText}
                </p>
              ) : null}
              {citations.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] pt-2">
                  {citations.map((cite, index) => (
                    <li
                      key={`${row.id}-cite-${index}`}
                      className="text-[11px] leading-snug text-muted-foreground"
                    >
                      {cite.url ? (
                        <a
                          href={cite.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {cite.title || cite.url}
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">
                          {cite.title || '引用'}
                        </span>
                      )}
                      {cite.snippet ? (
                        <span className="mt-0.5 block line-clamp-1">
                          {cite.snippet}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function ResearchTimeline({
  explanations,
  activities = [],
  subagents = [],
  reasoningText = '',
  isReasoningStreaming = false,
  onAction,
}: {
  explanations: ModelExplanation[]
  activities?: AgentActivityItem[]
  subagents?: AgentSubagent[]
  reasoningText?: string
  isReasoningStreaming?: boolean
  onAction?: (explanation: ModelExplanation) => void
}) {
  const { latest, history } = useModelObservation(explanations)
  const fallbackReasoning = reasoningFromActivities(activities)
  const displayReasoning = reasoningText.trim() || fallbackReasoning
  const hasReasoning = displayReasoning.length > 0 || isReasoningStreaming
  const recentActivities = activities
    .slice()
    .reverse()
    .slice(0, 12)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4">
      <SubagentTimeline subagents={subagents} />

      {hasReasoning ? (
        <section className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-muted-foreground">
            推理内容
          </p>
          <ConversationReasoning
            content={displayReasoning}
            isStreaming={isReasoningStreaming}
            defaultOpen
            autoClose={false}
            className="max-w-none rounded-xl border border-[var(--units-stroke-color)] bg-background"
          />
        </section>
      ) : null}

      {latest ? (
        <section className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-muted-foreground">
            当前进度
          </p>
          <ModelObservationCard explanation={latest} onAction={onAction} />
        </section>
      ) : !hasReasoning ? (
        <div className="rounded-2xl border border-dashed border-[var(--units-stroke-color)] bg-background/70 px-4 py-8 text-center">
          <p className="text-[13px] text-muted-foreground">
            推理正文、结论与证据会在此按时间呈现
          </p>
        </div>
      ) : null}

      {history.length > 1 ? (
        <section className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-muted-foreground">
            结论与证据
          </p>
          <ModelTrace explanations={history} onAction={onAction} />
        </section>
      ) : null}

      {recentActivities.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-muted-foreground">
            活动记录
          </p>
          <ul className="flex flex-col gap-2">
            {recentActivities.map((item) => (
              <li
                key={item.id}
                className="rounded-xl bg-[var(--units-wash-strong)] px-3 py-2.5"
              >
                <p className="text-[13px] font-medium leading-5">{item.summary}</p>
                {item.crumb ? (
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
                    {item.crumb}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function ResearchDrawer({
  explanations,
  activities = [],
  subagents = [],
  reasoningText = '',
  isReasoningStreaming = false,
  className,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  onAction,
}: ResearchDrawerProps) {
  const titleId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    onOpenChange?.(next)
    if (openProp === undefined) setUncontrolledOpen(next)
  }

  const displayReasoning =
    reasoningText.trim() || reasoningFromActivities(activities)
  const entryCount = Math.max(
    explanations.length,
    activities.length,
    displayReasoning ? 1 : 0
  )
  const { latest } = useModelObservation(explanations)
  const latestActivity = activities
    .slice()
    .sort((a, b) => b.sequence - a.sequence)[0]
  const headerHint = latestActivity?.summary
    ? latestActivity.summary
    : latest?.summary
      ? latest.summary
      : displayReasoning
        ? displayReasoning
            .replace(/^#+\s+/gm, '')
            .replace(/\s+/g, ' ')
            .slice(0, 72) + (displayReasoning.length > 72 ? '…' : '')
        : '推理正文、进度与证据按时间回溯'

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // setOpen closes over latest openProp/onOpenChange each render; rebind when open flips.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- setOpen is stable enough here

  return (
    <div className={cn('pointer-events-none absolute inset-0 z-30', className)}>
      <div className="pointer-events-auto absolute end-3 top-3 z-40 sm:end-4 sm:top-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={titleId}
          className="h-9 gap-1.5 rounded-full border-[var(--units-stroke-color)] bg-background/95 px-3 text-[12px] font-semibold shadow-sm backdrop-blur-sm"
          onClick={() => setOpen(!open)}
        >
          <FlaskConical className="size-3.5 text-[var(--units-orange)]" />
          研究过程
          {entryCount > 0 ? (
            <span className="text-muted-foreground">· {entryCount} 条</span>
          ) : null}
        </Button>
      </div>

      {open ? (
        <button
          type="button"
          aria-label="关闭研究过程"
          className="pointer-events-auto absolute inset-0 bg-[color-mix(in_srgb,var(--units-black)_18%,transparent)]"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id={titleId}
        role="dialog"
        aria-modal="true"
        aria-label="研究过程"
        aria-hidden={!open}
        className={cn(
          'pointer-events-auto absolute inset-y-0 end-0 flex w-full max-w-[360px] flex-col border-s border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_92%,#fff)] shadow-[-12px_0_40px_color-mix(in_srgb,var(--units-black)_10%,transparent)] transition-transform duration-300 units-ease motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--units-stroke-color)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-[16px] font-semibold tracking-tight">
              研究过程
            </h2>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
              {headerHint}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-lg"
            aria-label="关闭"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </header>

        <ResearchTimeline
          explanations={explanations}
          activities={activities}
          subagents={subagents}
          reasoningText={displayReasoning}
          isReasoningStreaming={isReasoningStreaming}
          onAction={onAction}
        />
      </aside>
    </div>
  )
}
