import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Circle,
  Clock,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { AddressLink } from '@/features/wallet/TxLink'
import type { OracleLegStatus, PolicyOracleStatus } from './policyApi'
import { getOracleStatusErrorKind } from './oracleStatusUtils'
import { useOracleStatusQuery } from './useOracleStatus'

// ---------------------------------------------------------------------------
// Countdown hook
// ---------------------------------------------------------------------------

function useCountdown(deadlineUnix: number | null): string | null {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (!deadlineUnix) return
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [deadlineUnix])

  if (!deadlineUnix) return null
  const diff = deadlineUnix - now
  if (diff <= 0) return '已就绪'
  const min = Math.floor(diff / 60)
  const sec = diff % 60
  if (min > 0) return `${min}分${sec.toString().padStart(2, '0')}秒`
  return `${sec}秒`
}

// ---------------------------------------------------------------------------
// Stepper for a single leg
// ---------------------------------------------------------------------------

const STEP_LABELS = ['待断言', '已断言', '已终结'] as const
const STEP_DISPUTED_LABEL = '争议中'

function LegStepper({ leg }: { leg: OracleLegStatus }) {
  // Map status to step index: 0=pending, 1=asserted/disputed, 2=resolved
  const stepIndex =
    leg.status === 3 ? 2 : leg.status >= 1 ? 1 : 0
  const isDisputed = leg.status === 2
  const countdown = useCountdown(leg.challengeDeadline)

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground leading-5">
            {leg.question}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            投保{' '}
            <span
              className={cn(
                'font-semibold',
                leg.side === 'YES'
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              )}
            >
              {leg.side}
            </span>
          </p>
        </div>
        {leg.status === 3 && leg.hit != null && (
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
              leg.hit
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            )}
          >
            {leg.hit ? (
              <Check className="size-3" />
            ) : (
              <Circle className="size-2.5 fill-current" />
            )}
          </span>
        )}
      </div>

      {/* Stepper track */}
      <div className="mt-3 flex items-center gap-1">
        {STEP_LABELS.map((label, idx) => {
          const isActive = idx === stepIndex
          const isDone = idx < stepIndex
          const showDisputed = isActive && isDisputed

          return (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-center">
                <div
                  className={cn(
                    'h-[3px] flex-1 rounded-full transition-colors',
                    idx === 0
                      ? 'bg-transparent'
                      : isDone || isActive
                        ? showDisputed
                          ? 'bg-amber-500/60'
                          : 'bg-emerald-500/60'
                        : 'bg-border'
                  )}
                />
                <div
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
                    isDone
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : isActive
                        ? showDisputed
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/20 text-blue-400'
                        : 'bg-secondary text-muted-foreground/40'
                  )}
                >
                  {isDone ? (
                    <Check className="size-2.5" />
                  ) : isActive ? (
                    <Loader2 className="size-2.5 animate-spin" />
                  ) : (
                    <Circle className="size-1.5 fill-current" />
                  )}
                </div>
                <div
                  className={cn(
                    'h-[3px] flex-1 rounded-full transition-colors',
                    idx === STEP_LABELS.length - 1
                      ? 'bg-transparent'
                      : isDone
                        ? 'bg-emerald-500/60'
                        : 'bg-border'
                  )}
                />
              </div>
              <span
                className={cn(
                  'text-[10px]',
                  isActive
                    ? showDisputed
                      ? 'font-semibold text-amber-400'
                      : 'font-semibold text-blue-400'
                    : isDone
                      ? 'text-emerald-400'
                      : 'text-muted-foreground/50'
                )}
              >
                {showDisputed ? STEP_DISPUTED_LABEL : label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Status detail row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {leg.status === 1 && countdown && (
          <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">
            <Clock className="size-3" />
            挑战窗口 {countdown}
          </span>
        )}
        {isDisputed && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
            <ShieldAlert className="size-3" />
            争议待仲裁
          </span>
        )}
        {leg.status === 3 && (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            <ShieldCheck className="size-3" />
            结果: {leg.finalYes ? 'YES' : 'NO'}
            {leg.hit != null && (
              <span className={leg.hit ? 'text-emerald-400' : 'text-rose-400'}>
                ({leg.hit ? '命中' : '未命中'})
              </span>
            )}
          </span>
        )}
        {leg.proposer && (
          <span className="text-muted-foreground/60">
            提议者 {leg.proposer.slice(0, 6)}…{leg.proposer.slice(-4)}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact mode (for health tab inline banner)
// ---------------------------------------------------------------------------

function OracleProgressCompact({
  data,
}: {
  data: PolicyOracleStatus
}) {
  const resolvedCount = data.legs.filter((l) => l.status === 3).length
  const total = data.legs.length
  const hasDispute = data.legs.some((l) => l.status === 2)

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        hasDispute
          ? 'border-amber-500/30 bg-amber-500/8'
          : 'border-blue-500/30 bg-blue-500/8'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex size-10 items-center justify-center">
          <svg className="size-10 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-border"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${data.progressPct * 0.94} 100`}
              strokeLinecap="round"
              className={hasDispute ? 'text-amber-400' : 'text-blue-400'}
            />
          </svg>
          <span className="absolute text-[9px] font-bold text-foreground">
            {data.progressPct}%
          </span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {data.allResolved
              ? '预言机结算结果'
              : hasDispute
                ? '预言机结算中 — 存在争议'
                : '预言机结算进行中'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {resolvedCount}/{total} 条市场已确认
            {!data.allResolved && ' · 挑战窗口验证中'}
          </p>
        </div>
        {hasDispute && (
          <AlertTriangle className="size-5 shrink-0 text-amber-400" />
        )}
        {!hasDispute && (
          <Shield className="size-5 shrink-0 text-blue-400" />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Full panel (for chain/monitoring tabs)
// ---------------------------------------------------------------------------

function OracleStatusFull({
  data,
  isRefetching,
}: {
  data: PolicyOracleStatus
  isRefetching: boolean
}) {
  const resolvedCount = data.legs.filter((l) => l.status === 3).length
  const total = data.legs.length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {data.allResolved ? '预言机结算结果' : '预言机结算状态'}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {resolvedCount}/{total} 条市场已确认 · 进度 {data.progressPct}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRefetching && (
            <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
          )}
          <AddressLink address={data.oracleAddress} label="Oracle" />
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${data.progressPct}%` }}
        />
      </div>

      {/* Config info */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span>挑战窗口: {data.livenessSeconds}s</span>
        <span>保证金: {data.bondUsdc} USDC</span>
      </div>

      {/* Per-leg status */}
      <div className="space-y-3">
        {data.legs.map((leg) => (
          <LegStepper key={leg.marketRef} leg={leg} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

function LegacyOracleEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-border p-4 text-center text-[13px] text-muted-foreground">
      当前使用直接结算路径，无需预言机验证。
    </div>
  )
}

export function OracleStatusPanel({
  policyId,
  enabled,
  poll = true,
  compact = false,
}: {
  policyId: string | undefined
  enabled: boolean
  /** When false, fetch once (settled history) without polling. */
  poll?: boolean
  compact?: boolean
}) {
  const { data, error, isLoading, isError, isRefetching, refetch } =
    useOracleStatusQuery(policyId, { enabled, poll })

  // Loading state
  if (isLoading && enabled) {
    return (
      <div
        className={cn(
          'animate-pulse rounded-xl border border-border p-4',
          compact ? '' : 'space-y-3'
        )}
      >
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-secondary" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded bg-secondary" />
            <div className="h-2.5 w-24 rounded bg-secondary" />
          </div>
        </div>
        {!compact && (
          <>
            <div className="h-2 rounded-full bg-secondary" />
            <div className="h-16 rounded-lg bg-secondary" />
          </>
        )}
      </div>
    )
  }

  // Error fallback — distinguish chain blips from hard unavailability
  if (isError) {
    const kind = getOracleStatusErrorKind(error)
    const isChain = kind === 'chain_unavailable'
    return (
      <div className="rounded-xl border border-border bg-secondary/20 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-[13px] text-muted-foreground">
              {isChain ? '链上状态暂时读取失败' : '预言机状态暂不可用'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {isChain
                ? 'RPC 或链上读取暂时异常，可稍后重试。'
                : '结算仍在后台正常进行，此页面会自动刷新。'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded px-2 py-1 text-[11px] text-primary hover:bg-primary/10"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    if (!enabled) return null
    return <LegacyOracleEmpty />
  }

  if (data.mode === 'legacy') {
    return <LegacyOracleEmpty />
  }

  if (compact) {
    return <OracleProgressCompact data={data} />
  }

  return <OracleStatusFull data={data} isRefetching={isRefetching} />
}
