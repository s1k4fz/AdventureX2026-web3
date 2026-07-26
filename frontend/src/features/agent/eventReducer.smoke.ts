import {
  applyAgentEvent,
  applyAgentEvents,
  createViewStateFromDetail,
} from './eventReducer'
import type { AgentEvent, AgentTaskDetail } from './types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const baseDetail: AgentTaskDetail = {
  id: 'task-1',
  kind: 'policy_planning',
  status: 'running',
  title: '利率路径对冲',
  goalText: '担心降息次数不及预期',
  updatedAt: '2026-07-24T00:00:00Z',
  createdAt: '2026-07-24T00:00:00Z',
  latestSequence: 0,
  runs: [],
  artifacts: [],
  approvals: [],
  inputs: [],
  recentEvents: [],
}

const events: AgentEvent[] = [
  {
    id: 'e1',
    sequence: 1,
    eventType: 'activity',
    data: { summary: '开始检索' },
    createdAt: '2026-07-24T00:00:01Z',
  },
  {
    id: 'e2',
    sequence: 2,
    eventType: 'approval.created',
    data: {
      approvalId: 'a1',
      kind: 'intake_answers',
      version: 1,
    },
    createdAt: '2026-07-24T00:00:02Z',
  },
  {
    id: 'e2-dup',
    sequence: 2,
    eventType: 'approval.created',
    data: {
      approvalId: 'a1',
      kind: 'intake_answers',
      version: 1,
    },
    createdAt: '2026-07-24T00:00:02Z',
  },
]

const state = createViewStateFromDetail({
  ...baseDetail,
  recentEvents: events.slice(0, 2),
})

assert(state.cursor === 2, 'cursor should advance to latest sequence')
assert(state.task.status === 'waiting_user', 'approval should wait for user')
assert(state.activities.length === 2, 'activity + approval should record')
assert(
  state.activities[1]?.summary === '需要你确认：填写风险问卷',
  'approval activity should use Chinese label'
)
assert(
  state.task.approvals.some((a) => a.id === 'a1' && a.status === 'pending'),
  'pending approval should exist'
)

const researched = applyAgentEvent(
  createViewStateFromDetail(baseDetail),
  {
    id: 'e-research',
    sequence: 1,
    eventType: 'research.updated',
    data: {
      phase: 'keyword_search',
      query: 'rate cuts',
      hitCount: 4,
      totalCount: 9,
    },
    createdAt: '2026-07-24T00:00:05Z',
  }
)
assert(
  researched.activities[0]?.summary.includes('rate cuts'),
  'research.updated should summarize query progress'
)

const deduped = applyAgentEvent(state, events[2]!)
assert(deduped.cursor === 2, 'duplicate sequence must be ignored')
assert(deduped.activities.length === 2, 'duplicate must not append activity')

const replayed = applyAgentEvents(
  createViewStateFromDetail(baseDetail),
  events.slice(0, 2)
)
assert(replayed.cursor === 2, 'replay should match live cursor')

const failed = applyAgentEvent(
  createViewStateFromDetail({
    ...baseDetail,
    runs: [
      {
        id: 'run-1',
        status: 'running',
        trigger: 'initial',
        createdAt: '2026-07-24T00:00:00Z',
        steps: [
          {
            id: 'step-1',
            name: 'market_search',
            seq: 1,
            status: 'running',
          },
        ],
      },
    ],
  }),
  {
    id: 'e3',
    sequence: 1,
    eventType: 'step.failed',
    runId: 'run-1',
    data: { step: 'market_search', code: 'policy_search_failed' },
    createdAt: '2026-07-24T00:00:03Z',
  }
)
assert(failed.task.status === 'failed', 'terminal step failure should fail task')
assert(
  failed.task.runs[0]?.steps[0]?.status === 'failed',
  'terminal step failure should fail matching step'
)

const monitoring = applyAgentEvent(
  {
    ...createViewStateFromDetail(baseDetail),
    activeViewId: 'policy-funding',
  },
  {
    id: 'e4',
    sequence: 1,
    eventType: 'task.monitoring',
    data: {},
    createdAt: '2026-07-24T00:00:04Z',
  }
)
assert(monitoring.task.status === 'monitoring', 'monitoring event should update status')
assert(
  monitoring.activeViewId === 'policy-journey',
  'monitoring event should keep the canvas on the journey view'
)

const fanout = applyAgentEvent(createViewStateFromDetail(baseDetail), {
  id: 'e-fanout',
  sequence: 1,
  eventType: 'subagent.fanout',
  data: {
    phase: 'dispatch',
    kinds: ['polymarket', 'world_monitor', 'pandaai', 'news', 'web'],
  },
  createdAt: '2026-07-24T00:00:06Z',
})
assert(
  fanout.activities[0]?.summary.includes('主理人派出'),
  'fanout should append dispatch activity'
)

const subProgress = applyAgentEvent(fanout, {
  id: 'e-sub-upd',
  sequence: 2,
  eventType: 'subagent.updated',
  data: {
    subagentId: 'sa-1',
    kind: 'news',
    status: 'running',
    summary: '博查检索中',
    progress: { phase: 'bocha', summary: '博查检索中' },
    query: '降息预期',
  },
  createdAt: '2026-07-24T00:00:07Z',
})
const newsRow = subProgress.task.subagents?.find((r) => r.kind === 'news')
assert(newsRow?.progress?.summary === '博查检索中', 'updated progress retained')
assert(newsRow?.queryText === '降息预期', 'queryText retained from event')

console.log('eventReducer smoke tests passed')
