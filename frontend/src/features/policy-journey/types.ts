import type { AgentSubagent, AgentTaskViewState } from '../agent/types'

export type JourneyStage =
  | 'needs'
  | 'risk_profile'
  | 'market_research'
  | 'coverage_plan'
  | 'on_chain_active'

export type StageStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'waiting_confirmation'
  | 'failed'
  | 'retry'

export interface ModelExplanation {
  id: string
  stage: JourneyStage
  status: 'thinking' | 'tool_calling' | 'verifying' | 'complete' | 'error'
  summary: string
  evidence?: { source: string; label: string; url?: string }[]
  toolStatus?: { name: string; status: 'running' | 'done' | 'error' }[]
  progress?: number
  action?: { label: string; type: string }
  createdAt: string
}

/** Minimal search progress shape (mirrors MarketSearchProgress). */
export interface JourneySearchProgress {
  platforms: Array<{ platform: string; count: number }>
  items: Array<{
    platform: string
    question: string
    volume: number | null
    endDate: string | null
    url?: string | null
    liquidity?: number | null
    conditionId?: string | null
  }>
  totalCount?: number
  sources?: Array<{
    kind: string
    status: string
    summary?: string
    itemCount?: number
  }>
}

/** Structural subset of PortfolioOut for journey state. */
export interface JourneyPortfolio {
  id: string
  tier: 'conservative' | 'balanced' | 'aggressive'
  title: string
  thesis: string | null
  premiumEstimate: number | null
  expectedPayout: number | null
  positions: unknown[]
}

export interface PolicyJourneyState {
  currentStage: JourneyStage
  stages: Record<JourneyStage, StageStatus>
  explanations: ModelExplanation[]
  latestExplanation: ModelExplanation | null
  legacyViewState: AgentTaskViewState | null
  search: JourneySearchProgress | null
  subagents: AgentSubagent[]
  reasoningText: string
  portfolios: JourneyPortfolio[]
  policyId: string | null
  isOverriding: boolean
  overrideRevision: number
}

export const JOURNEY_STAGES_ORDERED: JourneyStage[] = [
  'needs',
  'risk_profile',
  'market_research',
  'coverage_plan',
  'on_chain_active',
]

export const STAGE_LABELS: Record<JourneyStage, string> = {
  needs: '确认需求',
  risk_profile: '风险画像',
  market_research: '采集情报',
  coverage_plan: '选择档位',
  on_chain_active: '链上确认',
}

/** “步骤 3 / 5 · 采集情报” — keeps flow position visible inside the canvas. */
export function stageKicker(stage: JourneyStage): string {
  const index = JOURNEY_STAGES_ORDERED.indexOf(stage)
  return `步骤 ${index + 1} / ${JOURNEY_STAGES_ORDERED.length} · ${STAGE_LABELS[stage]}`
}
