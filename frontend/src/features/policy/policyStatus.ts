import { useEffect, useState } from 'react'

export type PolicyStatus =
  | 'intake'
  | 'composing'
  | 'proposed'
  | 'funded'
  | 'active'
  | 'settled'
  | 'failed'

export type PolicyFilterTab = 'all' | 'in_progress' | 'active' | 'settled'

export const POLICY_STATUS_LABELS: Record<string, string> = {
  intake: '需求收集中',
  composing: '方案编排中',
  proposed: '待出资',
  funded: '已出资',
  active: '保障生效中',
  settled: '已结算',
  failed: '失败',
}

export const POLICY_STATUS_COLORS: Record<string, string> = {
  intake: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  composing: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  proposed: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  funded: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  settled: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
}

const IN_PROGRESS_STATUSES = new Set(['proposed', 'funded', 'composing', 'intake'])

export function matchesPolicyFilter(
  status: string,
  filter: PolicyFilterTab
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'in_progress':
      return IN_PROGRESS_STATUSES.has(status)
    case 'active':
      return status === 'active'
    case 'settled':
      return status === 'settled'
    default:
      return true
  }
}

export function formatCountdown(endIso: string | null | undefined): string | null {
  if (!endIso) return null
  const end = new Date(endIso).getTime()
  const now = Date.now()
  const diffMs = end - now
  if (diffMs <= 0) return '已到期'
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时`
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  return `${minutes} 分钟`
}

export function isPolicyAttentionWorthy(
  item: {
    status: string
    coverageEnd?: string | null
  },
  referenceTimeMs: number
): boolean {
  if (item.status !== 'active' || !item.coverageEnd) return false
  return isCoverageWithinDays(item.coverageEnd, 7, referenceTimeMs)
}

export const MIN_PREMIUM_USDC = 10
export const PREMIUM_PRESETS = [50, 100, 500] as const

/** Stable clock for date comparisons — avoids Date.now() during render. */
export function useReferenceTime(refreshMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), refreshMs)
    return () => window.clearInterval(id)
  }, [refreshMs])
  return now
}

export function isCoverageExpired(
  coverageEnd: string | null | undefined,
  referenceTimeMs: number
): boolean {
  if (!coverageEnd) return false
  return new Date(coverageEnd).getTime() <= referenceTimeMs
}

export function isCoverageWithinDays(
  coverageEnd: string | null | undefined,
  days: number,
  referenceTimeMs: number
): boolean {
  if (!coverageEnd) return false
  const end = new Date(coverageEnd).getTime()
  if (end <= referenceTimeMs) return true
  return end - referenceTimeMs <= days * 24 * 60 * 60 * 1000
}

/**
 * A policy is "locked" once coverage is active or settled on-chain.
 * Locked policies reject further user inputs and task modifications.
 */
export function isPolicyLocked(status: string): boolean {
  return status === 'active' || status === 'settled'
}
