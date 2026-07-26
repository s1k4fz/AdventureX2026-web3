import {
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  XCircle,
} from 'lucide-react'

import {
  getSubagentIdentity,
  MAIN_AGENT_IDENTITY,
} from '@/features/agent/subagentIdentity'
import {
  SUBAGENT_STATUS_LABELS,
  type AgentSubagentKind,
  type AgentSubagentStatus,
} from '@/features/agent/types'
import { cn } from '@/lib/utils'

function StatusDot({
  status,
  className,
}: {
  status?: AgentSubagentStatus
  className?: string
}) {
  if (!status) return null
  if (status === 'succeeded') {
    return (
      <CheckCircle2
        className={cn('size-3 text-[var(--units-green)]', className)}
        aria-hidden
      />
    )
  }
  if (status === 'failed') {
    return (
      <XCircle className={cn('size-3 text-destructive', className)} aria-hidden />
    )
  }
  if (status === 'skipped') {
    return (
      <CircleDashed
        className={cn('size-3 text-muted-foreground', className)}
        aria-hidden
      />
    )
  }
  if (status === 'running') {
    return (
      <LoaderCircle
        className={cn(
          'size-3 animate-spin text-[var(--units-orange)]',
          className
        )}
        aria-hidden
      />
    )
  }
  return (
    <span
      className={cn(
        'size-1.5 rounded-full bg-[color-mix(in_srgb,var(--units-black)_22%,transparent)]',
        className
      )}
      aria-hidden
    />
  )
}

export type SubagentBadgeProps = {
  kind?: AgentSubagentKind | string
  /** When true, render the main agent (主理人) badge instead of a subagent. */
  mainAgent?: boolean
  status?: AgentSubagentStatus
  size?: 'sm' | 'md'
  /** Show role / duty label under the alias. */
  showRole?: boolean
  /** Show status text next to the alias. */
  showStatusLabel?: boolean
  className?: string
  /** Dim inactive (pending) badges in the dispatch theater. */
  dimmed?: boolean
}

export function SubagentBadge({
  kind,
  mainAgent = false,
  status,
  size = 'md',
  showRole = true,
  showStatusLabel = false,
  className,
  dimmed = false,
}: SubagentBadgeProps) {
  const identity = mainAgent
    ? {
        alias: MAIN_AGENT_IDENTITY.alias,
        role: MAIN_AGENT_IDENTITY.role,
        accent: MAIN_AGENT_IDENTITY.accent,
        monogram: MAIN_AGENT_IDENTITY.monogram,
        technical: 'Main',
      }
    : getSubagentIdentity(kind)

  const face = size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-[12px]'
  const aliasClass =
    size === 'sm' ? 'text-[12px] font-semibold' : 'text-[13px] font-semibold'
  const roleClass = size === 'sm' ? 'text-[10px]' : 'text-[11px]'

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-2',
        dimmed && 'opacity-45',
        className
      )}
      title={
        mainAgent
          ? `${identity.alias} · ${identity.role}`
          : `${identity.alias} · ${identity.role}（${identity.technical}）`
      }
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-semibold text-[var(--units-on-accent)]',
          face
        )}
        style={{
          background: `color-mix(in srgb, ${identity.accent} 88%, transparent)`,
          color: 'var(--units-brand-plate)',
        }}
        aria-hidden
      >
        {identity.monogram}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn('truncate text-foreground', aliasClass)}>
            {identity.alias}
          </span>
          <StatusDot status={status} />
          {showStatusLabel && status ? (
            <span className="text-[10px] text-muted-foreground">
              {SUBAGENT_STATUS_LABELS[status]}
            </span>
          ) : null}
        </span>
        {showRole ? (
          <span
            className={cn(
              'block truncate text-muted-foreground',
              roleClass
            )}
          >
            {identity.role}
          </span>
        ) : null}
      </span>
    </span>
  )
}
