/** Agent Task wire types (camelCase, mirrors backend schemas/agent_task.py). */

export type AgentTaskKind = 'policy_planning'
export type AgentTaskStatus =
  | 'draft'
  | 'running'
  | 'waiting_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'monitoring'

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AgentStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

export type AgentApprovalKind =
  | 'intake_answers'
  | 'select_portfolio'
  | 'confirm_funding'

export type AgentApprovalStatus =
  | 'pending'
  | 'submitted'
  | 'expired'
  | 'cancelled'

export type AgentTaskInputStatus =
  | 'queued'
  | 'applying'
  | 'applied'
  | 'superseded'

export type AgentSubagentKind =
  | 'polymarket'
  | 'world_monitor'
  | 'pandaai'
  | 'news'
  | 'web'
  | 'synthesizer'

export type AgentSubagentStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'

export interface AgentCitation {
  title?: string
  url?: string | null
  kind?: string
  snippet?: string
}

export interface AgentSourceBriefMeta {
  provider?: string
  fallbackFrom?: string | null
  query?: string
  latencyMs?: number
  resultCount?: number
  attempts?: Array<{
    provider?: string
    ok?: boolean
    count?: number
    error?: string
    skipped?: boolean
  }>
  [key: string]: unknown
}

export interface AgentSourceBrief {
  kind?: string
  status?: string
  summary?: string
  item_count?: number
  itemCount?: number
  citations?: AgentCitation[]
  meta?: AgentSourceBriefMeta
  error_code?: string | null
  error_message?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  [key: string]: unknown
}

export const SUBAGENT_STATUS_LABELS: Record<AgentSubagentStatus, string> = {
  pending: '排队中',
  running: '进行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '已跳过',
}

export const INTEL_PROVIDER_LABELS: Record<string, string> = {
  bocha: '博查',
  duckduckgo: 'DuckDuckGo',
  google_news_rss: 'Google News',
  none: '无可用源',
}

export interface AgentSubagent {
  id: string
  kind: AgentSubagentKind
  status: AgentSubagentStatus
  parentStep?: string
  queryText?: string | null
  progress?: Record<string, unknown> | null
  brief?: AgentSourceBrief | null
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  runId?: string | null
}

export interface AgentStep {
  id: string
  name: string
  seq: number
  status: AgentStepStatus
  progress?: Record<string, unknown> | null
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface AgentRun {
  id: string
  status: AgentRunStatus
  trigger: string
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  steps: AgentStep[]
}

export interface AgentArtifact {
  id: string
  refType: string
  refId: string
  role: string
  label?: string | null
  meta?: Record<string, unknown> | null
  createdAt: string
}

export interface AgentApproval {
  id: string
  kind: AgentApprovalKind
  status: AgentApprovalStatus
  version: number
  payload?: Record<string, unknown> | null
  response?: Record<string, unknown> | null
  submittedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentTaskInput {
  id: string
  type: 'free_text' | 'revise_goal'
  text: string
  revision: number
  status: AgentTaskInputStatus
  createdAt: string
  appliedAt?: string | null
}

/**
 * Agent event envelope. Known `eventType` values include:
 * task.created | task.cancelled | task.failed | task.monitoring |
 * step.updated | step.failed | activity | research.updated |
 * subagent.fanout | subagent.fanin |
 * subagent.started | subagent.updated | subagent.completed | subagent.failed |
 * input.queued | input.applying | input.applied |
 * approval.created | approval.submitted | artifact.upserted |
 * model.explanation.updated (optional; journey UI degrades to activity.crumb)
 */
export interface AgentEvent {
  id: string
  sequence: number
  eventType: string
  data: Record<string, unknown>
  runId?: string | null
  createdAt: string
}

export interface AgentTaskListItem {
  id: string
  kind: AgentTaskKind
  status: AgentTaskStatus
  title: string
  description?: string | null
  goalText: string
  primaryRefType?: string | null
  primaryRefId?: string | null
  conversationId?: string | null
  archivedAt?: string | null
  inputRevision?: number
  updatedAt: string
  createdAt: string
}

export interface AgentTaskDetail extends AgentTaskListItem {
  errorCode?: string | null
  errorMessage?: string | null
  latestSequence: number
  runs: AgentRun[]
  artifacts: AgentArtifact[]
  approvals: AgentApproval[]
  inputs: AgentTaskInput[]
  subagents?: AgentSubagent[]
  recentEvents: AgentEvent[]
}

export interface AgentActivityItem {
  id: string
  sequence: number
  summary: string
  createdAt: string
  crumb?: string
}

export interface AgentTaskViewState {
  task: AgentTaskDetail
  cursor: number
  activities: AgentActivityItem[]
  activeArtifactId: string | null
  /** Canvas stage tab id (questionnaire / research / …). */
  activeViewId: string | null
}

export const POLICY_STEP_LABELS: Record<string, string> = {
  describe: '描述风险',
  questionnaire: '确认需求',
  market_search: '采集情报',
  compose: '生成方案',
  select_portfolio: '选择档位',
  funding: '链上确认',
  monitor: '持续监控',
}

/** Alias-first labels (工牌名). Prefer getSubagentIdentity() for full identity. */
export const SUBAGENT_KIND_LABELS: Record<AgentSubagentKind, string> = {
  polymarket: '行情侦察',
  world_monitor: '全球瞭望',
  pandaai: '量数观测',
  news: '新闻猎手',
  web: '网页探查',
  synthesizer: '情报官',
}

export const SUBAGENT_KIND_ORDER: AgentSubagentKind[] = [
  'polymarket',
  'world_monitor',
  'pandaai',
  'news',
  'web',
  'synthesizer',
]
