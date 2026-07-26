import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  TrendingUp,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { TxLink } from '@/features/wallet/TxLink'
import type { PolicyDetail, PolicyOracleStatus } from './policyApi'
import { formatUsd } from './portfolioUtils'
import { findSelectedPortfolio } from './portfolioUtils'

// ---------------------------------------------------------------------------
// Settlement phase derivation
// ---------------------------------------------------------------------------

type SettlePhase =
  | 'awaiting_trigger' // 待触发
  | 'asserting' // 正在断言
  | 'challenge_window' // 挑战窗口中
  | 'finalizing' // 正在终结
  | 'settling' // 链上结算中
  | 'settled' // 已完成

interface PhaseInfo {
  phase: SettlePhase
  label: string
  description: string
  progress: number // 0-100
}

function derivePhase(
  policy: PolicyDetail,
  oracle: PolicyOracleStatus | undefined
): PhaseInfo {
  if (policy.status === 'settled') {
    return {
      phase: 'settled',
      label: '结算完成',
      description: '链上结算已确认，赔付已到账。',
      progress: 100,
    }
  }

  if (!oracle || oracle.mode === 'legacy') {
    return {
      phase: 'awaiting_trigger',
      label: '等待结算触发',
      description: '保障已到期，等待系统触发结算（直传路径）。',
      progress: 5,
    }
  }

  const legs = oracle.legs
  const pending = legs.filter((l) => l.status === 0).length
  const asserted = legs.filter((l) => l.status === 1).length
  const resolved = legs.filter((l) => l.status === 3).length
  const total = legs.length

  if (oracle.allResolved) {
    return {
      phase: 'settling',
      label: '链上结算中',
      description: '所有标的已确认，正在执行链上赔付交易。',
      progress: 95,
    }
  }
  if (pending === total) {
    return {
      phase: 'awaiting_trigger',
      label: '等待结算触发',
      description: '保障已到期，等待系统对各标的发起链上断言。',
      progress: 5,
    }
  }
  if (asserted > 0 && resolved < total) {
    return {
      phase: 'challenge_window',
      label: '挑战窗口验证中',
      description: `${asserted} 条标的正在挑战窗口验证，${resolved}/${total} 已确认。`,
      progress: 20 + (resolved / total) * 60,
    }
  }
  if (pending > 0) {
    return {
      phase: 'asserting',
      label: '断言提交中',
      description: `${total - pending}/${total} 条标的已提交断言。`,
      progress: 10 + ((total - pending) / total) * 10,
    }
  }
  return {
    phase: 'finalizing',
    label: '终结确认中',
    description: `正在终结挑战窗口已过期的断言，${resolved}/${total} 已完成。`,
    progress: 80 + (resolved / total) * 15,
  }
}

// ---------------------------------------------------------------------------
// Expected payout computation
// ---------------------------------------------------------------------------

interface LegOutcome {
  question: string
  side: 'YES' | 'NO'
  outcomeYes: boolean | null
  hit: boolean | null
  resolved: boolean
  marketRef: string
}

function computeExpectedPayout(
  policy: PolicyDetail,
  oracle: PolicyOracleStatus | undefined
): {
  expectedPayout: number | null
  legs: LegOutcome[]
  resolvedCount: number
  hitCount: number
} {
  const selected = findSelectedPortfolio(
    policy.portfolios,
    policy.selectedPortfolioId
  )
  if (!selected || !oracle) {
    return { expectedPayout: null, legs: [], resolvedCount: 0, hitCount: 0 }
  }

  const positions = selected.positions
  const legs: LegOutcome[] = []
  let resolvedCount = 0
  let hitCount = 0

  for (const oracleLeg of oracle.legs) {
    const pos = positions.find(
      (p) => p.marketRef.toLowerCase() === oracleLeg.marketRef.toLowerCase()
    )
    const resolved = oracleLeg.status === 3
    const outcomeYes = resolved ? oracleLeg.finalYes : null
    const hit = oracleLeg.hit
    if (resolved) resolvedCount++
    if (hit) hitCount++
    legs.push({
      question: oracleLeg.question,
      side: pos?.side ?? (oracleLeg.side as 'YES' | 'NO'),
      outcomeYes,
      hit,
      resolved,
      marketRef: oracleLeg.marketRef,
    })
  }

  // Compute expected payout using the same formula as the contract:
  // payout = sum of shares for legs where side matches outcome
  // shares_i = net * weight_i / 10000 * 10000 / entryPrice_i
  // net = premium * (10000 - feeBps) / 10000  (feeBps ~100)
  if (policy.premium == null) {
    return { expectedPayout: null, legs, resolvedCount, hitCount }
  }

  const feeBps = 100
  const premiumBase = policy.premium * 1_000_000
  const net = (premiumBase * (10000 - feeBps)) / 10000
  let payout = 0
  let allDetermined = true

  for (const oracleLeg of oracle.legs) {
    const pos = positions.find(
      (p) => p.marketRef.toLowerCase() === oracleLeg.marketRef.toLowerCase()
    )
    if (!pos) continue
    const allocated = (net * pos.weight) / 10000
    const shares = (allocated * 10000) / pos.entryPriceBps
    if (oracleLeg.status === 3 && oracleLeg.finalYes != null) {
      const posIsYes = pos.side === 'YES'
      if (posIsYes === oracleLeg.finalYes) {
        payout += shares
      }
    } else {
      allDetermined = false
    }
  }

  const payoutUsdc = allDetermined ? payout / 1_000_000 : null
  return { expectedPayout: payoutUsdc, legs, resolvedCount, hitCount }
}

// ---------------------------------------------------------------------------
// Phase stepper
// ---------------------------------------------------------------------------

const PHASES: { phase: SettlePhase; label: string; short: string }[] = [
  { phase: 'awaiting_trigger', label: '触发', short: '触发' },
  { phase: 'asserting', label: '断言', short: '断言' },
  { phase: 'challenge_window', label: '验证', short: '验证' },
  { phase: 'finalizing', label: '终结', short: '终结' },
  { phase: 'settling', label: '赔付', short: '赔付' },
  { phase: 'settled', label: '完成', short: '完成' },
]

function phaseIndex(phase: SettlePhase): number {
  return PHASES.findIndex((p) => p.phase === phase)
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

function useCountdownSec(deadlineUnix: number | null): number | null {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!deadlineUnix) return
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [deadlineUnix])
  if (!deadlineUnix) return null
  const diff = deadlineUnix - now
  return diff > 0 ? diff : 0
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}:${sec.toString().padStart(2, '0')}`
  return `${sec}s`
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettlementProgressCard({
  policy,
  oracle,
  settleQueued,
}: {
  policy: PolicyDetail
  oracle: PolicyOracleStatus | undefined
  settleQueued?: boolean
}) {
  const phaseInfo = derivePhase(policy, oracle)
  const currentIdx = phaseIndex(phaseInfo.phase)
  const { expectedPayout, legs, resolvedCount, hitCount } = computeExpectedPayout(policy, oracle)

  // Find the latest challenge deadline for countdown
  const latestDeadline = oracle?.legs
    .filter((l) => l.status === 1)
    .reduce((max, l) => Math.max(max, l.challengeDeadline ?? 0), 0) ?? null
  const countdown = useCountdownSec(latestDeadline && latestDeadline > 0 ? latestDeadline : null)

  const isSettled = policy.status === 'settled'
  const premium = policy.premium ?? 0
  const netProfit = expectedPayout != null ? expectedPayout - premium : null

  return (
    <div
      className={cn(
        'rounded-2xl border p-5',
        isSettled
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-blue-500/30 bg-blue-500/5'
      )}
    >
      {/* Phase stepper */}
      <div className="mb-4 flex items-center gap-1">
        {PHASES.map((p, idx) => {
          const isDone = idx < currentIdx
          const isCurrent = idx === currentIdx
          return (
            <div key={p.phase} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-center">
                {idx > 0 && (
                  <div
                    className={cn(
                      'h-[2px] flex-1 rounded-full',
                      isDone ? 'bg-emerald-500/50' : isCurrent ? 'bg-blue-500/40' : 'bg-border'
                    )}
                  />
                )}
                <div
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full',
                    isDone
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : isCurrent
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-secondary text-muted-foreground/40'
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-3" />
                  ) : isCurrent ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Circle className="size-2 fill-current" />
                  )}
                </div>
                {idx < PHASES.length - 1 && (
                  <div
                    className={cn(
                      'h-[2px] flex-1 rounded-full',
                      isDone ? 'bg-emerald-500/50' : 'bg-border'
                    )}
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-[9px]',
                  isDone
                    ? 'text-emerald-400'
                    : isCurrent
                      ? 'font-semibold text-blue-400'
                      : 'text-muted-foreground/50'
                )}
              >
                {p.short}
              </span>
            </div>
          )
        })}
      </div>

      {/* Phase description */}
      <div className="flex items-center gap-2">
        {phaseInfo.phase === 'settled' ? (
          <CheckCircle2 className="size-4 text-emerald-400" />
        ) : settleQueued || phaseInfo.phase !== 'awaiting_trigger' ? (
          <Loader2 className="size-4 animate-spin text-blue-400" />
        ) : (
          <Clock className="size-4 text-muted-foreground" />
        )}
        <p className="text-sm font-semibold text-foreground">{phaseInfo.label}</p>
        {countdown != null && countdown > 0 && (
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[11px] text-blue-300">
            {formatSec(countdown)}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{phaseInfo.description}</p>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/50">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700',
            isSettled
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-blue-500 to-emerald-500'
          )}
          style={{ width: `${phaseInfo.progress}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-background/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">投入保费</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
            {formatUsd(premium)}
          </p>
        </div>
        <div className="rounded-lg bg-background/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {isSettled ? '实际赔付' : '预计赔付'}
          </p>
          <p className={cn(
            'mt-0.5 font-mono text-sm font-semibold',
            isSettled ? 'text-primary' : expectedPayout != null ? 'text-blue-400' : 'text-muted-foreground'
          )}>
            {isSettled
              ? formatUsd(policy.payout ?? 0)
              : expectedPayout != null
                ? formatUsd(expectedPayout)
                : '计算中…'}
          </p>
        </div>
        <div className="rounded-lg bg-background/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">净收益</p>
          <p className={cn(
            'mt-0.5 font-mono text-sm font-semibold',
            netProfit != null && netProfit >= 0
              ? 'text-emerald-400'
              : netProfit != null
                ? 'text-rose-400'
                : 'text-muted-foreground'
          )}>
            {isSettled && policy.payout != null
              ? `${policy.payout - premium >= 0 ? '+' : ''}${formatUsd(policy.payout - premium)}`
              : netProfit != null
                ? `${netProfit >= 0 ? '+' : ''}${formatUsd(netProfit)}`
                : '—'}
          </p>
        </div>
      </div>

      {/* Per-leg outcome preview */}
      {legs.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            市场结果 ({resolvedCount}/{legs.length} 已确认
            {hitCount > 0 && ` · ${hitCount} 命中`})
          </p>
          {legs.map((leg) => (
            <div
              key={leg.marketRef}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/30 px-3 py-2"
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  leg.resolved
                    ? leg.hit
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-rose-500/20 text-rose-400'
                    : 'bg-secondary text-muted-foreground/50'
                )}
              >
                {leg.resolved ? (
                  leg.hit ? (
                    <TrendingUp className="size-2.5" />
                  ) : (
                    <Circle className="size-2 fill-current" />
                  )
                ) : (
                  <Loader2 className="size-2.5 animate-spin" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-foreground">{leg.question}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      'font-semibold',
                      leg.side === 'YES' ? 'text-emerald-400' : 'text-rose-400'
                    )}
                  >
                    投保 {leg.side}
                  </span>
                  {leg.resolved && (
                    <>
                      <ArrowRight className="size-2.5" />
                      <span>结果: {leg.outcomeYes ? 'YES' : 'NO'}</span>
                      <span
                        className={cn(
                          'font-semibold',
                          leg.hit ? 'text-emerald-400' : 'text-rose-400'
                        )}
                      >
                        {leg.hit ? '命中' : '未命中'}
                      </span>
                    </>
                  )}
                  {!leg.resolved && <span className="italic">等待确认…</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Settle TX if available */}
      {policy.settleTx && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Zap className="size-3" />
          结算交易 <TxLink hash={policy.settleTx} />
        </div>
      )}
    </div>
  )
}
