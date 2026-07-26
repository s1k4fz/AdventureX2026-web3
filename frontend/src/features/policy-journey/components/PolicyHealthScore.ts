import type { ModelExplanation } from '../types'
import type { PolicyDetail, PolicyMarks } from '../../policy/policyApi'
import { isCoverageExpired } from '../../policy/policyStatus'
import { isLowLiquidityPosition } from '../../policy/portfolioUtils'

export interface HealthRisk {
  id: string
  label: string
  severity: 'low' | 'medium' | 'high'
}

export interface HealthScore {
  score: number
  label: string
  keyRisks: HealthRisk[]
  nextAction: { label: string; route?: string } | null
}

function scoreLabel(score: number): string {
  if (score >= 85) return '优'
  if (score >= 70) return '良'
  if (score >= 50) return '中'
  return '差'
}

export function computePolicyHealthScore(input: {
  policy: PolicyDetail
  marks?: PolicyMarks | null
  /** True while the first marks fetch is in flight (do not penalize). */
  marksLoading?: boolean
  /** True when the marks query failed (distinct from empty quotes). */
  marksError?: boolean
  explanations?: ModelExplanation[]
  nowMs?: number
}): HealthScore {
  const {
    policy,
    marks,
    marksLoading = false,
    marksError = false,
    explanations = [],
    nowMs = Date.now(),
  } = input
  const risks: HealthRisk[] = []
  let score = 100

  const premium = policy.premium ?? 0
  const markValue = marks?.totalMarkValue ?? null
  const coverageStatus = marks?.coverage?.status

  if (markValue != null && premium > 0) {
    const deviation = Math.abs(markValue - premium) / premium
    if (deviation > 0.35) {
      score -= 25
      risks.push({
        id: 'mark-deviation-high',
        label: '盯市价值相对保费偏离较大',
        severity: 'high',
      })
    } else if (deviation > 0.15) {
      score -= 12
      risks.push({
        id: 'mark-deviation-med',
        label: '盯市价值出现中等偏离',
        severity: 'medium',
      })
    }
    if (coverageStatus === 'partial') {
      score -= 4
      risks.push({
        id: 'marks-partial',
        label: `部分头寸暂无报价（${marks?.coverage?.quoted ?? 0}/${marks?.coverage?.total ?? 0}）`,
        severity: 'low',
      })
    }
    if (marks?.stale) {
      score -= 3
      risks.push({
        id: 'marks-stale',
        label: '盯市行情可能已过期',
        severity: 'low',
      })
    }
  } else if (policy.status === 'active') {
    // Loading: do not deduct — conflating with「暂无盯市」was the prior bug.
    if (marksLoading && !marks) {
      // no-op
    } else if (marksError && !marks) {
      score -= 6
      risks.push({
        id: 'marks-error',
        label: '盯市行情拉取失败',
        severity: 'low',
      })
    } else if (coverageStatus === 'partial') {
      score -= 6
      risks.push({
        id: 'marks-partial',
        label: `部分头寸暂无报价（${marks?.coverage?.quoted ?? 0}/${marks?.coverage?.total ?? 0}）`,
        severity: 'medium',
      })
    } else if (
      coverageStatus === 'none' ||
      marks?.unavailableReason ||
      markValue == null
    ) {
      score -= 8
      const reason = marks?.unavailableReason
      risks.push({
        id: 'marks-missing',
        label:
          reason === 'gamma_no_markets' || reason?.startsWith('gamma_')
            ? '盯市行情暂不可用（上游无报价）'
            : '暂无盯市数据',
        severity: 'low',
      })
    }
  }

  if (policy.coverageEnd) {
    const end = Date.parse(policy.coverageEnd)
    const startCandidate = policy.openedAt ?? policy.createdAt
    const start = startCandidate
      ? Date.parse(startCandidate)
      : end - 30 * 24 * 60 * 60 * 1000
    const total = Math.max(end - start, 1)
    const remaining = Math.max(end - nowMs, 0)
    const ratio = remaining / total
    if (isCoverageExpired(policy.coverageEnd, nowMs)) {
      score -= 20
      risks.push({
        id: 'coverage-expired',
        label: '保障期已结束，等待结算',
        severity: 'high',
      })
    } else if (ratio < 0.15) {
      score -= 10
      risks.push({
        id: 'coverage-ending',
        label: '保障期即将结束',
        severity: 'medium',
      })
    }
  }

  const riskSignals = explanations.filter(
    (e) =>
      e.status === 'error' ||
      /risk|风险|偏离|流动性/i.test(e.summary)
  ).length
  if (riskSignals >= 3) {
    score -= 15
    risks.push({
      id: 'model-risk-signals',
      label: `模型观测含 ${riskSignals} 条风险信号`,
      severity: 'high',
    })
  } else if (riskSignals >= 1) {
    score -= 6
    risks.push({
      id: 'model-risk-soft',
      label: '模型观测出现风险提示',
      severity: 'low',
    })
  }

  const selected =
    policy.portfolios.find((p) => p.id === policy.selectedPortfolioId) ??
    policy.portfolios[0]
  const lowLiq = selected?.positions.filter(isLowLiquidityPosition).length ?? 0
  if (lowLiq > 0) {
    score -= Math.min(18, lowLiq * 6)
    risks.push({
      id: 'low-liquidity',
      label: `${lowLiq} 个头寸流动性偏弱`,
      severity: lowLiq >= 2 ? 'high' : 'medium',
    })
  }

  if (policy.status === 'failed') {
    score = Math.min(score, 25)
    risks.push({
      id: 'policy-failed',
      label: '保单处于失败状态',
      severity: 'high',
    })
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let nextAction: HealthScore['nextAction'] = null
  if (policy.status === 'proposed') {
    nextAction = { label: '选择档位并出资', route: `/policy/${policy.id}` }
  } else if (policy.status === 'active' && risks.some((r) => r.id === 'coverage-expired')) {
    nextAction = { label: '查看结算进度' }
  } else if (
    (policy.status === 'active' || policy.status === 'settled') &&
    !policy.nftTokenId
  ) {
    nextAction = {
      label: '铸造保单 NFT',
      route: `/policy/${policy.id}?tab=nft`,
    }
  } else if (policy.status === 'failed') {
    nextAction = { label: '返回任务重试编排' }
  } else if (risks.some((r) => r.severity === 'high')) {
    nextAction = { label: '查看模型观测与头寸' }
  }

  return {
    score,
    label: scoreLabel(score),
    keyRisks: risks.slice(0, 4),
    nextAction,
  }
}
