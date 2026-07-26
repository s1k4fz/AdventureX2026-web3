import {
  summarizeApprovalCreated,
  summarizeResearchUpdated,
  summarizeSubagentEvent,
} from '../agent/activitySummaries'
import type {
  AgentEvent,
  AgentSubagent,
  AgentSubagentKind,
  AgentSubagentStatus,
  AgentTaskViewState,
} from '../agent/types'
import type {
  JourneyPortfolio,
  JourneySearchProgress,
  JourneyStage,
  ModelExplanation,
  PolicyJourneyState,
  StageStatus,
} from './types'
import { JOURNEY_STAGES_ORDERED } from './types'
import { toJourneyStage } from './mapLegacyStage'

const MAX_EXPLANATIONS = 50

function emptyStages(): Record<JourneyStage, StageStatus> {
  return {
    needs: 'idle',
    risk_profile: 'idle',
    market_research: 'idle',
    coverage_plan: 'idle',
    on_chain_active: 'idle',
  }
}

export function createEmptyJourneyState(
  overrides?: Partial<PolicyJourneyState>
): PolicyJourneyState {
  return {
    currentStage: 'needs',
    stages: emptyStages(),
    explanations: [],
    latestExplanation: null,
    legacyViewState: null,
    search: null,
    subagents: [],
    reasoningText: '',
    portfolios: [],
    policyId: null,
    isOverriding: false,
    overrideRevision: 0,
    ...overrides,
  }
}

function stageIndex(stage: JourneyStage): number {
  return JOURNEY_STAGES_ORDERED.indexOf(stage)
}

function markStagesUpTo(
  stages: Record<JourneyStage, StageStatus>,
  current: JourneyStage,
  currentStatus: StageStatus
): Record<JourneyStage, StageStatus> {
  const next = { ...stages }
  const currentIdx = stageIndex(current)
  for (let i = 0; i < JOURNEY_STAGES_ORDERED.length; i++) {
    const key = JOURNEY_STAGES_ORDERED[i]!
    if (i < currentIdx) {
      // HITL stages sit on `waiting_confirmation` until the user acts; once we
      // advance past them they must show as completed (not stay dashed/future).
      if (next[key] !== 'failed') {
        next[key] = 'success'
      }
    } else if (i === currentIdx) {
      next[key] = currentStatus
    } else if (
      next[key] !== 'failed' &&
      next[key] !== 'waiting_confirmation'
    ) {
      // Clear future stages when we move backward (override) or stay ahead idle
      if (currentStatus === 'loading' || currentStatus === 'retry') {
        next[key] = 'idle'
      }
    }
  }
  return next
}

function clearFromStage(
  stages: Record<JourneyStage, StageStatus>,
  from: JourneyStage
): Record<JourneyStage, StageStatus> {
  const next = { ...stages }
  const fromIdx = stageIndex(from)
  for (let i = fromIdx; i < JOURNEY_STAGES_ORDERED.length; i++) {
    next[JOURNEY_STAGES_ORDERED[i]!] = 'loading'
  }
  return next
}

function parseExplanation(
  event: AgentEvent,
  fallbackStage: JourneyStage
): ModelExplanation | null {
  const data = event.data
  const id =
    typeof data.id === 'string' && data.id
      ? data.id
      : `expl-${event.id}`
  const stageRaw = typeof data.stage === 'string' ? data.stage : fallbackStage
  const stage = (
    JOURNEY_STAGES_ORDERED.includes(stageRaw as JourneyStage)
      ? stageRaw
      : fallbackStage
  ) as JourneyStage

  const statusRaw = typeof data.status === 'string' ? data.status : 'thinking'
  const status = (
    ['thinking', 'tool_calling', 'verifying', 'complete', 'error'] as const
  ).includes(statusRaw as ModelExplanation['status'])
    ? (statusRaw as ModelExplanation['status'])
    : 'thinking'

  const summary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary.trim()
      : ''

  if (!summary && status !== 'error') {
    return null
  }

  const evidence = Array.isArray(data.evidence)
    ? (data.evidence as ModelExplanation['evidence'])
    : undefined
  const toolStatus = Array.isArray(data.toolStatus)
    ? (data.toolStatus as ModelExplanation['toolStatus'])
    : undefined
  const progress =
    typeof data.progress === 'number' ? data.progress : undefined
  const action =
    data.action && typeof data.action === 'object'
      ? (data.action as ModelExplanation['action'])
      : undefined

  return {
    id,
    stage,
    status,
    summary: summary || '模型观测异常',
    evidence,
    toolStatus,
    progress,
    action,
    createdAt: event.createdAt,
  }
}

function truncateEvidenceLabel(text: string, max = 72): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

/** Sample markets → evidence chips (never promote raw CoT crumb to summary). */
function evidenceFromResearchItems(
  items: unknown
): ModelExplanation['evidence'] {
  if (!Array.isArray(items)) return undefined
  const evidence: NonNullable<ModelExplanation['evidence']> = []
  for (const item of items.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue
    const question = (item as { question?: unknown }).question
    const platform = (item as { platform?: unknown }).platform
    if (typeof question !== 'string' || !question.trim()) continue
    evidence.push({
      source:
        typeof platform === 'string' && platform.trim()
          ? platform.trim()
          : '市场',
      label: truncateEvidenceLabel(question),
    })
  }
  return evidence.length ? evidence : undefined
}

function syntheticFromActivity(
  event: AgentEvent,
  stage: JourneyStage
): ModelExplanation | null {
  // CoT safety: only the user-facing Chinese activity summary becomes the card
  // headline. Raw crumb must never be promoted to summary.
  const summary =
    typeof event.data.summary === 'string' ? event.data.summary.trim() : ''
  if (!summary) return null
  return {
    id: `synth-${event.id}`,
    stage,
    status: 'complete',
    summary,
    createdAt: event.createdAt,
  }
}

function toolStatusFromSources(
  sources: unknown
): ModelExplanation['toolStatus'] {
  if (!Array.isArray(sources)) return undefined
  const out: NonNullable<ModelExplanation['toolStatus']> = []
  for (const row of sources) {
    if (!row || typeof row !== 'object') continue
    const kind = (row as { kind?: unknown }).kind
    const status = (row as { status?: unknown }).status
    if (typeof kind !== 'string' || !kind) continue
    const mapped =
      status === 'failed'
        ? 'error'
        : status === 'succeeded' || status === 'skipped'
          ? 'done'
          : 'running'
    out.push({ name: kind, status: mapped })
  }
  return out.length ? out : undefined
}

function syntheticFromResearch(event: AgentEvent): ModelExplanation {
  const toolStatus =
    toolStatusFromSources(event.data.sources) ??
    [{ name: 'market_search', status: 'done' as const }]
  return {
    id: `synth-${event.id}`,
    stage: 'market_research',
    status: 'complete',
    summary: summarizeResearchUpdated(event.data),
    evidence: evidenceFromResearchItems(event.data.items),
    toolStatus,
    createdAt: event.createdAt,
  }
}

function upsertSubagent(
  list: AgentSubagent[],
  row: AgentSubagent
): AgentSubagent[] {
  const index = list.findIndex(
    (item) => item.id === row.id || item.kind === row.kind
  )
  if (index < 0) return [...list, row]
  const prev = list[index]!
  const next = list.slice()
  next[index] = {
    ...prev,
    ...row,
    id: prev.id ?? row.id,
    startedAt: prev.startedAt ?? row.startedAt ?? null,
    createdAt: prev.createdAt || row.createdAt,
    brief: row.brief ?? prev.brief ?? null,
    progress: row.progress ?? prev.progress ?? null,
    queryText: row.queryText ?? prev.queryText ?? null,
    parentStep: row.parentStep ?? prev.parentStep,
  }
  return next
}

function syntheticFromApproval(
  event: AgentEvent,
  stage: JourneyStage
): ModelExplanation {
  const kind = String(event.data.kind ?? '')
  const base = {
    id: `synth-${event.id}`,
    stage,
    summary: summarizeApprovalCreated(event.data.kind),
    createdAt: event.createdAt,
  }

  if (kind === 'confirm_funding') {
    return {
      ...base,
      status: 'verifying',
      summary: '档位已锁定，等待你在钱包中确认链上出资',
      progress: 55,
      toolStatus: [
        { name: '选择保障档位', status: 'done' },
        { name: '连接钱包并确认出资', status: 'running' },
      ],
    }
  }

  if (kind === 'select_portfolio') {
    return {
      ...base,
      status: 'verifying',
      progress: 45,
      toolStatus: [
        { name: '方案编排', status: 'done' },
        { name: '选择保障档位', status: 'running' },
      ],
    }
  }

  if (kind === 'intake_answers') {
    return {
      ...base,
      status: 'verifying',
      progress: 15,
      toolStatus: [
        { name: '生成风险问卷', status: 'done' },
        { name: '填写风险问卷', status: 'running' },
      ],
    }
  }

  return {
    ...base,
    status: 'verifying',
  }
}

function upsertExplanation(
  list: ModelExplanation[],
  item: ModelExplanation
): ModelExplanation[] {
  const index = list.findIndex((row) => row.id === item.id)
  if (index < 0) return [...list, item].slice(-MAX_EXPLANATIONS)
  const next = list.slice()
  next[index] = item
  return next.slice(-MAX_EXPLANATIONS)
}

function inferStageFromView(
  view: AgentTaskViewState | null
): { stage: JourneyStage; status: StageStatus } {
  if (!view) return { stage: 'needs', status: 'idle' }
  const { task } = view
  const pending = task.approvals.filter((a) => a.status === 'pending')

  if (task.status === 'failed') {
    // Runs are serialized oldest -> newest; only the latest retry/revision is
    // authoritative. An older compose failure must not pull a newer market
    // failure forward into the plan canvas.
    const latestRun = task.runs[task.runs.length - 1]
    const failedStep = (latestRun?.steps ?? [])
      .filter((step) => step.status === 'failed')
      .sort((a, b) => b.seq - a.seq)[0]
    if (failedStep?.name === 'compose') {
      return { stage: 'coverage_plan', status: 'failed' }
    }
    if (failedStep?.name === 'market_search') {
      return { stage: 'market_research', status: 'failed' }
    }
    return { stage: 'needs', status: 'failed' }
  }
  if (task.status === 'cancelled') {
    return { stage: 'needs', status: 'failed' }
  }
  if (
    task.status === 'monitoring' ||
    task.status === 'succeeded'
  ) {
    return { stage: 'on_chain_active', status: 'success' }
  }
  if (pending.some((a) => a.kind === 'confirm_funding')) {
    return { stage: 'on_chain_active', status: 'waiting_confirmation' }
  }
  if (pending.some((a) => a.kind === 'select_portfolio')) {
    return { stage: 'coverage_plan', status: 'waiting_confirmation' }
  }
  if (pending.some((a) => a.kind === 'intake_answers')) {
    return { stage: 'needs', status: 'waiting_confirmation' }
  }
  if (task.status === 'running') {
    const hasIntake = task.approvals.some(
      (a) => a.kind === 'intake_answers' && a.status === 'submitted'
    )
    if (!hasIntake) {
      return { stage: 'needs', status: 'loading' }
    }
    // Only the latest run is authoritative. Compose is marked running when the
    // questionnaire is submitted, but it still gates on market_search; show
    // the plan canvas only after that gate has actually succeeded.
    const latestRun = task.runs[task.runs.length - 1]
    const steps = latestRun?.steps ?? []
    const marketStep = steps.find((s) => s.name === 'market_search')
    const composeStep = steps.find((s) => s.name === 'compose')
    if (
      marketStep?.status === 'succeeded' &&
      composeStep?.status === 'running'
    ) {
      return { stage: 'coverage_plan', status: 'loading' }
    }
    if (
      marketStep?.status === 'running' ||
      marketStep?.status === 'succeeded'
    ) {
      return { stage: 'market_research', status: 'loading' }
    }
    return { stage: 'risk_profile', status: 'loading' }
  }
  if (task.status === 'waiting_user') {
    return { stage: 'needs', status: 'waiting_confirmation' }
  }
  return { stage: 'needs', status: 'idle' }
}

export function syncJourneyFromView(
  state: PolicyJourneyState,
  view: AgentTaskViewState | null,
  extras?: {
    search?: JourneySearchProgress | null
    reasoningText?: string
    portfolios?: JourneyPortfolio[]
    policyId?: string | null
    policyStage?:
      | 'questionnaire'
      | 'searching'
      | 'proposed'
      | 'active'
      | 'failed'
  }
): PolicyJourneyState {
  const inferred = inferStageFromView(view)
  let currentStage = inferred.stage
  let status = inferred.status

  if (extras?.policyStage && extras.policyStage !== 'failed') {
    const fromPolicy = toJourneyStage(extras.policyStage, {
      questionnaireSubmitted: Boolean(
        view?.task.approvals.some(
          (a) => a.kind === 'intake_answers' && a.status === 'submitted'
        )
      ),
    })
    // Prefer more advanced of policy vs task inference
    if (stageIndex(fromPolicy) > stageIndex(currentStage)) {
      currentStage = fromPolicy
      if (extras.policyStage === 'proposed') {
        status = 'waiting_confirmation'
      } else if (extras.policyStage === 'active') {
        status = 'success'
      } else if (extras.policyStage === 'searching') {
        status = 'loading'
      }
    }
  }

  if (state.isOverriding) {
    status = 'loading'
  }

  const stages = markStagesUpTo(state.stages, currentStage, status)
  const fromSnapshot = view?.task.subagents ?? []
  let subagents = state.subagents
  if (fromSnapshot.length) {
    subagents = fromSnapshot.reduce(
      (acc, row) => upsertSubagent(acc, row),
      subagents
    )
  }

  return {
    ...state,
    currentStage,
    stages,
    legacyViewState: view,
    search: extras?.search ?? state.search,
    subagents,
    reasoningText: extras?.reasoningText ?? state.reasoningText,
    portfolios: extras?.portfolios ?? state.portfolios,
    policyId: extras?.policyId ?? state.policyId,
  }
}

/** Pure reducer: apply a single AgentEvent onto PolicyJourneyState. */
export function applyJourneyEvent(
  state: PolicyJourneyState,
  event: AgentEvent
): PolicyJourneyState {
  switch (event.eventType) {
    case 'model.explanation.updated': {
      const explanation = parseExplanation(event, state.currentStage)
      if (!explanation) return state
      const explanations = upsertExplanation(state.explanations, explanation)
      const advancesStage =
        stageIndex(explanation.stage) > stageIndex(state.currentStage) &&
        (explanation.status === 'thinking' ||
          explanation.status === 'tool_calling' ||
          explanation.status === 'verifying')
      return {
        ...state,
        currentStage: advancesStage ? explanation.stage : state.currentStage,
        stages: advancesStage
          ? markStagesUpTo(state.stages, explanation.stage, 'loading')
          : state.stages,
        explanations,
        latestExplanation: explanation,
      }
    }
    case 'activity': {
      // Degrade: only synthesize when no real model.explanation.updated has
      // arrived yet. Uses Chinese activity summary (never raw CoT crumb).
      const hasReal = state.explanations.some(
        (e) => !e.id.startsWith('synth-')
      )
      if (hasReal) return state
      const synth = syntheticFromActivity(event, state.currentStage)
      if (!synth) return state
      const explanations = upsertExplanation(state.explanations, synth)
      return {
        ...state,
        explanations,
        latestExplanation: synth,
      }
    }
    case 'subagent.fanout':
    case 'subagent.fanin': {
      const synth: ModelExplanation = {
        id: `synth-${event.id}`,
        stage: 'market_research',
        status: 'tool_calling',
        summary: summarizeSubagentEvent(event.eventType, event.data),
        toolStatus: state.subagents.map((item) => ({
          name: item.kind,
          status:
            item.status === 'failed'
              ? ('error' as const)
              : item.status === 'succeeded' || item.status === 'skipped'
                ? ('done' as const)
                : ('running' as const),
        })),
        createdAt: event.createdAt,
      }
      return {
        ...state,
        explanations: upsertExplanation(state.explanations, synth),
        latestExplanation: synth,
      }
    }
    case 'subagent.started':
    case 'subagent.updated':
    case 'subagent.completed':
    case 'subagent.failed': {
      const kind = String(event.data.kind ?? '') as AgentSubagentKind
      const status = String(
        event.data.status ??
          (event.eventType === 'subagent.failed' ? 'failed' : 'running')
      ) as AgentSubagentStatus
      const progress =
        event.data.progress && typeof event.data.progress === 'object'
          ? (event.data.progress as Record<string, unknown>)
          : event.eventType === 'subagent.updated' &&
              typeof event.data.summary === 'string'
            ? { summary: event.data.summary }
            : null
      const queryText =
        typeof event.data.query === 'string'
          ? event.data.query
          : typeof event.data.queryText === 'string'
            ? event.data.queryText
            : null
      const row: AgentSubagent = {
        id: String(event.data.subagentId ?? `kind-${kind}`),
        kind: kind || 'polymarket',
        status,
        parentStep:
          typeof event.data.parentStep === 'string'
            ? event.data.parentStep
            : 'market_search',
        queryText,
        progress,
        brief:
          event.data.brief && typeof event.data.brief === 'object'
            ? (event.data.brief as Record<string, unknown>)
            : {
                summary: event.data.summary,
                itemCount: event.data.itemCount,
              },
        errorCode:
          typeof event.data.errorCode === 'string'
            ? event.data.errorCode
            : null,
        errorMessage:
          typeof event.data.errorMessage === 'string'
            ? event.data.errorMessage
            : null,
        startedAt:
          event.eventType === 'subagent.started' ? event.createdAt : null,
        createdAt: event.createdAt,
        finishedAt:
          event.eventType === 'subagent.completed' ||
          event.eventType === 'subagent.failed'
            ? event.createdAt
            : null,
      }
      const subagents = upsertSubagent(state.subagents, row)
      const toolStatus = subagents.map((item) => ({
        name: item.kind,
        status:
          item.status === 'failed'
            ? ('error' as const)
            : item.status === 'succeeded' || item.status === 'skipped'
              ? ('done' as const)
              : ('running' as const),
      }))
      const synth: ModelExplanation = {
        id: `synth-${event.id}`,
        stage: 'market_research',
        status:
          event.eventType === 'subagent.failed' ? 'error' : 'tool_calling',
        summary: summarizeSubagentEvent(event.eventType, event.data),
        toolStatus,
        createdAt: event.createdAt,
      }
      // Soft failures stay toolStatus-only — do not persist as lasting error cards.
      const explanations =
        event.eventType === 'subagent.failed'
          ? state.explanations
          : upsertExplanation(state.explanations, synth)
      // Keep user on needs while questionnaire is open; only jump when already
      // past intake or actively viewing research.
      const stayOnNeeds =
        state.currentStage === 'needs' || state.currentStage === 'risk_profile'
      return {
        ...state,
        currentStage: stayOnNeeds ? state.currentStage : 'market_research',
        stages: stayOnNeeds
          ? {
              ...state.stages,
              market_research:
                state.stages.market_research === 'success'
                  ? 'success'
                  : 'loading',
            }
          : markStagesUpTo(state.stages, 'market_research', 'loading'),
        subagents,
        explanations,
        latestExplanation: synth,
      }
    }
    case 'research.updated': {
      const platforms = event.data.platforms
      const items = event.data.items
      const sources = Array.isArray(event.data.sources)
        ? (event.data.sources as NonNullable<JourneySearchProgress['sources']>)
        : undefined
      let next = state
      if (Array.isArray(platforms) && Array.isArray(items)) {
        const totalCount =
          typeof event.data.totalCount === 'number' &&
          Number.isFinite(event.data.totalCount)
            ? event.data.totalCount
            : items.length
        next = {
          ...state,
          search: {
            platforms: platforms as JourneySearchProgress['platforms'],
            items: items as JourneySearchProgress['items'],
            totalCount,
            sources: sources ?? state.search?.sources,
          },
          currentStage: 'market_research',
          stages: markStagesUpTo(
            state.stages,
            'market_research',
            state.isOverriding ? 'loading' : 'loading'
          ),
        }
      } else if (sources) {
        next = {
          ...state,
          search: {
            platforms: state.search?.platforms ?? [],
            items: state.search?.items ?? [],
            sources,
          },
          currentStage: 'market_research',
          stages: markStagesUpTo(state.stages, 'market_research', 'loading'),
        }
      } else if (next.currentStage !== 'market_research') {
        next = {
          ...next,
          currentStage: 'market_research',
          stages: markStagesUpTo(
            next.stages,
            'market_research',
            state.isOverriding ? 'loading' : 'loading'
          ),
        }
      }
      const synth = syntheticFromResearch(event)
      const explanations = upsertExplanation(next.explanations, synth)
      return {
        ...next,
        explanations,
        latestExplanation: synth,
      }
    }
    case 'input.queued': {
      const revision = Number(
        event.data.revision ?? state.overrideRevision + 1
      )
      return {
        ...state,
        isOverriding: true,
        overrideRevision: revision,
        stages: clearFromStage(state.stages, state.currentStage),
      }
    }
    case 'input.applying': {
      const revision = Number(
        event.data.revision ?? state.overrideRevision
      )
      return {
        ...state,
        isOverriding: true,
        overrideRevision: revision,
      }
    }
    case 'input.applied': {
      return {
        ...state,
        isOverriding: false,
      }
    }
    case 'approval.created': {
      const kind = String(event.data.kind ?? '')
      let next = state
      if (kind === 'intake_answers') {
        next = {
          ...state,
          currentStage: 'needs',
          stages: markStagesUpTo(
            state.stages,
            'needs',
            'waiting_confirmation'
          ),
          isOverriding: false,
        }
      } else if (kind === 'select_portfolio') {
        next = {
          ...state,
          currentStage: 'coverage_plan',
          stages: markStagesUpTo(
            state.stages,
            'coverage_plan',
            'waiting_confirmation'
          ),
          isOverriding: false,
        }
      } else if (kind === 'confirm_funding') {
        next = {
          ...state,
          currentStage: 'on_chain_active',
          stages: markStagesUpTo(
            state.stages,
            'on_chain_active',
            'waiting_confirmation'
          ),
          isOverriding: false,
        }
      }
      const synth = syntheticFromApproval(event, next.currentStage)
      const explanations = upsertExplanation(next.explanations, synth)
      return {
        ...next,
        explanations,
        latestExplanation: synth,
        isOverriding: false,
      }
    }
    case 'approval.submitted': {
      const kind = String(event.data.kind ?? '')
      // Advance toward next loading stage after user confirms
      if (state.currentStage === 'needs' || kind === 'intake_answers') {
        const synth: ModelExplanation = {
          id: `synth-${event.id}`,
          stage: 'risk_profile',
          status: 'thinking',
          summary: '问卷已提交，正在编排保障方案',
          progress: 25,
          toolStatus: [
            { name: '填写风险问卷', status: 'done' },
            { name: '风险画像与采集', status: 'running' },
          ],
          createdAt: event.createdAt,
        }
        return {
          ...state,
          currentStage: 'risk_profile',
          stages: markStagesUpTo(state.stages, 'risk_profile', 'loading'),
          explanations: upsertExplanation(state.explanations, synth),
          latestExplanation: synth,
        }
      }
      if (state.currentStage === 'coverage_plan' || kind === 'select_portfolio') {
        const synth: ModelExplanation = {
          id: `synth-${event.id}`,
          stage: 'on_chain_active',
          status: 'verifying',
          summary: '档位已选择，正在准备链上出资确认…',
          progress: 50,
          toolStatus: [
            { name: '选择保障档位', status: 'done' },
            { name: '准备出资计划', status: 'running' },
          ],
          createdAt: event.createdAt,
        }
        return {
          ...state,
          currentStage: 'on_chain_active',
          stages: markStagesUpTo(
            state.stages,
            'on_chain_active',
            'loading'
          ),
          explanations: upsertExplanation(state.explanations, synth),
          latestExplanation: synth,
        }
      }
      return state
    }
    case 'task.failed':
    case 'step.failed':
      return {
        ...state,
        isOverriding: false,
        stages: {
          ...state.stages,
          [state.currentStage]: 'failed',
        },
      }
    case 'task.monitoring':
      return {
        ...state,
        isOverriding: false,
        currentStage: 'on_chain_active',
        stages: markStagesUpTo(state.stages, 'on_chain_active', 'success'),
      }
    default:
      return state
  }
}

export function applyJourneyEvents(
  state: PolicyJourneyState,
  events: AgentEvent[]
): PolicyJourneyState {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .reduce(applyJourneyEvent, state)
}

export function createJourneyStateFromView(
  view: AgentTaskViewState | null,
  extras?: {
    search?: JourneySearchProgress | null
    reasoningText?: string
    portfolios?: JourneyPortfolio[]
    policyId?: string | null
    policyStage?:
      | 'questionnaire'
      | 'searching'
      | 'proposed'
      | 'active'
      | 'failed'
  }
): PolicyJourneyState {
  const events = view?.task.recentEvents ?? []
  const base = createEmptyJourneyState()
  const withEvents = applyJourneyEvents(base, events)
  return syncJourneyFromView(withEvents, view, extras)
}
