import {
  applyJourneyEvent,
  applyJourneyEvents,
  createEmptyJourneyState,
  createJourneyStateFromView,
} from './journeyReducer'
import type { AgentEvent, AgentTaskDetail } from '../agent/types'
import { createViewStateFromDetail } from '../agent/eventReducer'
import { toJourneyStage, toLegacyStage } from './mapLegacyStage'
import { JOURNEY_STAGES_ORDERED } from './types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- mapLegacyStage ---
assert(toJourneyStage('questionnaire') === 'needs', 'questionnaire → needs')
assert(
  toJourneyStage('questionnaire', { questionnaireSubmitted: true }) ===
    'risk_profile',
  'submitted questionnaire → risk_profile'
)
assert(toJourneyStage('searching') === 'market_research', 'searching map')
assert(toJourneyStage('proposed') === 'coverage_plan', 'proposed map')
assert(toJourneyStage('active') === 'on_chain_active', 'active map')
assert(toLegacyStage('needs') === 'questionnaire', 'needs → questionnaire')
assert(toLegacyStage('risk_profile') === 'questionnaire', 'risk_profile fold')
assert(toLegacyStage('market_research') === 'searching', 'research → searching')
assert(toLegacyStage('coverage_plan') === 'proposed', 'plan → proposed')
assert(toLegacyStage('on_chain_active') === 'active', 'active reverse')

// --- model.explanation.updated ---
let state = createEmptyJourneyState()
const explEvent: AgentEvent = {
  id: 'e-expl',
  sequence: 1,
  eventType: 'model.explanation.updated',
  data: {
    id: 'm1',
    stage: 'market_research',
    status: 'tool_calling',
    summary: '正在检索 Polymarket 候选合约',
    progress: 42,
    toolStatus: [{ name: 'market_search', status: 'running' }],
  },
  createdAt: '2026-07-25T00:00:01Z',
}
state = applyJourneyEvent(state, explEvent)
assert(state.latestExplanation?.id === 'm1', 'explanation id')
assert(state.latestExplanation?.summary.includes('Polymarket'), 'summary')
assert(state.explanations.length === 1, 'one explanation')
assert(
  state.currentStage === 'market_research',
  'running explanation advances into market research'
)

const composeProgressState = applyJourneyEvent(state, {
  id: 'e-compose-progress',
  sequence: 2,
  eventType: 'model.explanation.updated',
  data: {
    id: 'compose-progress',
    stage: 'coverage_plan',
    status: 'tool_calling',
    summary: '已锁定有效候选，正在生成三档方案',
    progress: 74,
  },
  createdAt: '2026-07-25T00:00:02Z',
})
assert(
  composeProgressState.currentStage === 'coverage_plan',
  'compose progress advances into coverage plan'
)
assert(
  composeProgressState.stages.coverage_plan === 'loading',
  'compose progress renders the loading plan canvas'
)

// Upsert same id
state = applyJourneyEvent(state, {
  ...explEvent,
  id: 'e-expl-2',
  sequence: 2,
  data: { ...explEvent.data, status: 'complete', progress: 100 },
})
assert(state.explanations.length === 1, 'upsert same explanation id')
assert(state.latestExplanation?.status === 'complete', 'status updated')

// --- activity summary synth (CoT crumb must not become headline) ---
let degrade = createEmptyJourneyState({ currentStage: 'risk_profile' })
degrade = applyJourneyEvent(degrade, {
  id: 'e-act',
  sequence: 1,
  eventType: 'activity',
  data: { summary: '分析风险', crumb: 'hidden cot text' },
  createdAt: '2026-07-25T00:00:01Z',
})
assert(
  degrade.latestExplanation?.summary === '分析风险',
  'summary uses Chinese activity summary'
)
assert(
  !String(degrade.latestExplanation?.summary ?? '').includes('hidden cot'),
  'crumb must not be used as summary'
)
assert(degrade.latestExplanation?.status === 'complete', 'historical synth complete')
assert(degrade.latestExplanation?.id.startsWith('synth-'), 'synth id')

// Crumb-only activity must not synthesize a card (would leak CoT as headline)
degrade = applyJourneyEvent(degrade, {
  id: 'e-act-crumb-only',
  sequence: 2,
  eventType: 'activity',
  data: { crumb: 'secret cot only' },
  createdAt: '2026-07-25T00:00:02Z',
})
assert(
  !degrade.explanations.some((e) => e.summary === 'secret cot only'),
  'crumb-only activity must not synth'
)

// Real explanation blocks further activity synth
degrade = applyJourneyEvent(degrade, explEvent)
const beforeLen = degrade.explanations.length
degrade = applyJourneyEvent(degrade, {
  id: 'e-act-2',
  sequence: 3,
  eventType: 'activity',
  data: { summary: '更多', crumb: 'secret' },
  createdAt: '2026-07-25T00:00:03Z',
})
assert(
  degrade.explanations.filter((e) => e.id.startsWith('synth-')).length <= 1,
  'no new activity synth after real explanation'
)
assert(degrade.explanations.length >= beforeLen, 'explanations retained')

// --- override flow ---
let override = createEmptyJourneyState({
  currentStage: 'coverage_plan',
  stages: {
    needs: 'success',
    risk_profile: 'success',
    market_research: 'success',
    coverage_plan: 'waiting_confirmation',
    on_chain_active: 'idle',
  },
})
override = applyJourneyEvent(override, {
  id: 'e-q',
  sequence: 10,
  eventType: 'input.queued',
  data: { inputId: 'in1', revision: 2, text: '改成更保守' },
  createdAt: '2026-07-25T00:01:00Z',
})
assert(override.isOverriding === true, 'queued sets overriding')
assert(override.overrideRevision === 2, 'revision set')
assert(override.stages.coverage_plan === 'loading', 'current cleared to loading')
assert(override.stages.on_chain_active === 'loading', 'future cleared')

override = applyJourneyEvent(override, {
  id: 'e-applying',
  sequence: 11,
  eventType: 'input.applying',
  data: { inputId: 'in1', revision: 2 },
  createdAt: '2026-07-25T00:01:01Z',
})
assert(override.isOverriding === true, 'applying keeps overriding')

override = applyJourneyEvent(override, {
  id: 'e-applied',
  sequence: 12,
  eventType: 'input.applied',
  data: { revision: 2 },
  createdAt: '2026-07-25T00:01:02Z',
})
assert(override.isOverriding === false, 'applied clears overriding')

// --- approval stage transitions ---
let appr = createEmptyJourneyState()
appr = applyJourneyEvent(appr, {
  id: 'e-appr',
  sequence: 1,
  eventType: 'approval.created',
  data: { approvalId: 'a1', kind: 'select_portfolio', version: 1 },
  createdAt: '2026-07-25T00:00:01Z',
})
assert(appr.currentStage === 'coverage_plan', 'select_portfolio stage')
assert(
  appr.stages.coverage_plan === 'waiting_confirmation',
  'waiting confirmation'
)
assert(
  appr.latestExplanation?.summary === '需要你确认：选择保障档位',
  'approval creates observation card'
)
assert(appr.latestExplanation?.status === 'verifying', 'approval synth verifying')
assert(
  appr.latestExplanation?.toolStatus?.some((t) => t.name === '选择保障档位'),
  'select approval shows tool status'
)
assert(
  typeof appr.latestExplanation?.progress === 'number',
  'select approval shows progress'
)
assert(appr.latestExplanation?.id.startsWith('synth-'), 'approval synth id')

appr = applyJourneyEvent(appr, {
  id: 'e-sub',
  sequence: 2,
  eventType: 'approval.submitted',
  data: { approvalId: 'a1', kind: 'select_portfolio' },
  createdAt: '2026-07-25T00:00:02Z',
})
assert(appr.currentStage === 'on_chain_active', 'after select → funding')
assert(
  appr.latestExplanation?.summary.includes('准备链上出资'),
  'select submitted shows funding hand-off'
)
assert(
  appr.stages.on_chain_active === 'loading',
  'select submitted briefly loads funding stage'
)

appr = applyJourneyEvent(appr, {
  id: 'e-fund',
  sequence: 3,
  eventType: 'approval.created',
  data: { approvalId: 'a2', kind: 'confirm_funding', version: 1 },
  createdAt: '2026-07-25T00:00:03Z',
})
assert(
  appr.stages.on_chain_active === 'waiting_confirmation',
  'confirm_funding waits for wallet'
)
assert(
  appr.stages.coverage_plan === 'success',
  'selecting a tier marks coverage_plan complete'
)
assert(
  appr.latestExplanation?.summary.includes('档位已锁定'),
  'confirm funding observation summary'
)
assert(
  appr.latestExplanation?.toolStatus?.some(
    (t) => t.name === '连接钱包并确认出资' && t.status === 'running'
  ),
  'confirm funding shows running wallet step'
)
assert(
  appr.latestExplanation?.progress === 55,
  'confirm funding shows mid progress'
)

// --- research.updated ---
let research = createEmptyJourneyState()
research = applyJourneyEvent(research, {
  id: 'e-res',
  sequence: 1,
  eventType: 'research.updated',
  data: {
    kind: 'search',
    platforms: [{ platform: 'polymarket', count: 16 }],
    items: [{ platform: 'polymarket', question: 'Fed cut?', volume: 100 }],
  },
  createdAt: '2026-07-25T00:00:01Z',
})
assert(research.search?.items.length === 1, 'search items')
assert(research.currentStage === 'market_research', 'research stage')
assert(
  research.latestExplanation?.summary.includes('编排检索已更新'),
  'research creates observation summary'
)
assert(
  research.latestExplanation?.evidence?.some((e) => e.label.includes('Fed cut')),
  'research evidence chips from sample markets'
)
assert(research.latestExplanation?.status === 'complete', 'research synth complete')
assert(
  research.latestExplanation?.toolStatus?.[0]?.status === 'done',
  'research tool status done'
)

// --- task.monitoring ---
research = applyJourneyEvent(research, {
  id: 'e-mon',
  sequence: 2,
  eventType: 'task.monitoring',
  data: {},
  createdAt: '2026-07-25T00:00:02Z',
})
assert(research.currentStage === 'on_chain_active', 'monitoring → active')
assert(research.stages.on_chain_active === 'success', 'active success')

// --- task.failed ---
let failed = createEmptyJourneyState({ currentStage: 'market_research' })
failed = applyJourneyEvent(failed, {
  id: 'e-fail',
  sequence: 1,
  eventType: 'task.failed',
  data: { message: 'boom' },
  createdAt: '2026-07-25T00:00:01Z',
})
assert(failed.stages.market_research === 'failed', 'failed status')
assert(failed.isOverriding === false, 'failed clears override')

// --- createJourneyStateFromView replays events ---
const detail: AgentTaskDetail = {
  id: 'task-1',
  kind: 'policy_planning',
  status: 'waiting_user',
  title: '测试',
  goalText: 'goal',
  updatedAt: '2026-07-25T00:00:00Z',
  createdAt: '2026-07-25T00:00:00Z',
  latestSequence: 2,
  runs: [],
  artifacts: [],
  approvals: [
    {
      id: 'a1',
      kind: 'intake_answers',
      status: 'pending',
      version: 1,
      payload: null,
      response: null,
      submittedAt: null,
      createdAt: '2026-07-25T00:00:02Z',
      updatedAt: '2026-07-25T00:00:02Z',
    },
  ],
  inputs: [],
  recentEvents: [
    {
      id: 'e1',
      sequence: 1,
      eventType: 'model.explanation.updated',
      data: {
        id: 'm0',
        stage: 'needs',
        status: 'complete',
        summary: '问卷已生成',
      },
      createdAt: '2026-07-25T00:00:01Z',
    },
    {
      id: 'e2',
      sequence: 2,
      eventType: 'approval.created',
      data: { approvalId: 'a1', kind: 'intake_answers', version: 1 },
      createdAt: '2026-07-25T00:00:02Z',
    },
  ],
}
const view = createViewStateFromDetail(detail)
const fromView = createJourneyStateFromView(view)
assert(fromView.explanations.some((e) => e.id === 'm0'), 'replay explanation')
assert(
  fromView.explanations.some(
    (e) =>
      e.id.startsWith('synth-') &&
      e.summary === '需要你确认：填写风险问卷'
  ),
  'replay approval synth observation'
)
assert(fromView.currentStage === 'needs', 'intake pending → needs')
assert(
  fromView.stages.needs === 'waiting_confirmation',
  'needs waiting'
)

// --- failed snapshot stays at the recoverable step ---
const failedDetailBase: AgentTaskDetail = {
  ...detail,
  status: 'failed',
  latestSequence: 0,
  approvals: [],
  recentEvents: [],
  runs: [
    {
      id: 'run-failed',
      status: 'failed',
      trigger: 'test',
      createdAt: '2026-07-25T00:02:00Z',
      steps: [],
    },
  ],
}

const marketFailure = createJourneyStateFromView(
  createViewStateFromDetail({
    ...failedDetailBase,
    runs: [
      {
        id: 'run-stale-compose-failure',
        status: 'failed',
        trigger: 'retry',
        createdAt: '2026-07-25T00:01:00Z',
        steps: [
          {
            id: 'step-stale-compose-failed',
            name: 'compose',
            seq: 30,
            status: 'failed',
          },
        ],
      },
      {
        ...failedDetailBase.runs[0]!,
        steps: [
          {
            id: 'step-market-failed',
            name: 'market_search',
            seq: 20,
            status: 'failed',
          },
        ],
      },
    ],
  })
)
assert(
  marketFailure.currentStage === 'market_research' &&
    marketFailure.stages.market_research === 'failed',
  'market failure stays on market research for retry'
)

const composeFailure = createJourneyStateFromView(
  createViewStateFromDetail({
    ...failedDetailBase,
    runs: [
      {
        ...failedDetailBase.runs[0]!,
        steps: [
          {
            id: 'step-market-succeeded',
            name: 'market_search',
            seq: 20,
            status: 'succeeded',
          },
          {
            id: 'step-compose-failed',
            name: 'compose',
            seq: 30,
            status: 'failed',
          },
        ],
      },
    ],
  })
)
assert(
  composeFailure.currentStage === 'coverage_plan' &&
    composeFailure.stages.coverage_plan === 'failed',
  'compose failure stays on coverage plan for retry'
)

// --- applyJourneyEvents order ---
const batched = applyJourneyEvents(createEmptyJourneyState(), [
  { ...explEvent, sequence: 5 },
  {
    id: 'e-early',
    sequence: 1,
    eventType: 'input.queued',
    data: { revision: 1 },
    createdAt: '2026-07-25T00:00:00Z',
  },
])
assert(batched.overrideRevision === 1, 'events sorted by sequence')
assert(batched.latestExplanation?.id === 'm1', 'later explanation applied')

assert(JOURNEY_STAGES_ORDERED.length === 5, 'five stages')

// --- subagent fanout / progress while on needs ---
let needsCollect = createEmptyJourneyState({ currentStage: 'needs' })
needsCollect = applyJourneyEvent(needsCollect, {
  id: 'e-fanout',
  sequence: 1,
  eventType: 'subagent.fanout',
  data: {
    phase: 'dispatch',
    kinds: ['polymarket', 'world_monitor', 'pandaai', 'news', 'web'],
  },
  createdAt: '2026-07-25T00:01:00Z',
})
assert(
  needsCollect.latestExplanation?.summary.includes('主理人派出'),
  'fanout observation on needs'
)
assert(needsCollect.currentStage === 'needs', 'fanout must not leave needs')

needsCollect = applyJourneyEvent(needsCollect, {
  id: 'e-sa',
  sequence: 2,
  eventType: 'subagent.updated',
  data: {
    subagentId: 'sa-news',
    kind: 'news',
    status: 'running',
    summary: 'Google News 拉取中',
    progress: { phase: 'google_news_rss', summary: 'Google News 拉取中' },
    query: '关税风险',
  },
  createdAt: '2026-07-25T00:01:01Z',
})
assert(needsCollect.currentStage === 'needs', 'subagent update stays on needs')
assert(
  needsCollect.stages.market_research === 'loading',
  'background collect marks market_research loading'
)
const news = needsCollect.subagents.find((r) => r.kind === 'news')
assert(news?.progress?.summary === 'Google News 拉取中', 'progress on journey')
assert(news?.queryText === '关税风险', 'query on journey subagent')

console.log('journeyReducer.smoke: all assertions passed')
