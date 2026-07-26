import {
  formatActivitiesAsReasoning,
  summarizeApprovalCreated,
  summarizeResearchUpdated,
  summarizeSubagentEvent,
} from './activitySummaries'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  summarizeResearchUpdated({
    phase: 'keywords',
    keywords: ['rate cuts', 'fed funds'],
  }).includes('2 条'),
  'keywords phase should count expansions'
)

assert(
  summarizeResearchUpdated({
    phase: 'queries',
    queries: ['rate cuts', 'fed funds'],
  }).includes('2 条'),
  'legacy queries phase should still work'
)

assert(
  summarizeResearchUpdated({
    phase: 'keyword_search',
    query: 'rate cuts',
    hitCount: 5,
    totalCount: 12,
  }) === '检索「rate cuts」，本轮命中 5 条，累计 12 个候选',
  'keyword_search phase should include query and counts'
)

assert(
  summarizeResearchUpdated({
    phase: 'leg',
    query: 'rate cuts',
    legCount: 5,
    totalCount: 12,
  }) === '检索「rate cuts」，本轮命中 5 条，累计 12 个候选',
  'legacy leg phase should still work'
)

assert(
  summarizeResearchUpdated({
    phase: 'terminal',
    status: 'searched',
    platforms: [
      { platform: 'polymarket', count: 20 },
      { platform: 'kalshi', count: 8 },
    ],
    items: [{ platform: 'polymarket', question: 'Will Fed cut?' }],
    totalCount: 28,
  }).includes('28 个'),
  'terminal phase should use totalCount'
)

assert(
  summarizeResearchUpdated({
    kind: 'search',
    platforms: [{ platform: 'polymarket', count: 16 }],
    items: [
      { platform: 'polymarket', question: 'A' },
      { platform: 'polymarket', question: 'B' },
    ],
    totalCount: 16,
  }).includes('编排检索已更新：16 个候选') &&
    !summarizeResearchUpdated({
      kind: 'search',
      platforms: [{ platform: 'polymarket', count: 16 }],
      items: [
        { platform: 'polymarket', question: 'A' },
        { platform: 'polymarket', question: 'B' },
      ],
      totalCount: 16,
    }).includes('展示'),
  'compose search kind should not say 展示 when pool is full'
)

assert(
  summarizeApprovalCreated('select_portfolio') ===
    '需要你确认：选择保障档位',
  'approval kind should be localized'
)

const reasoning = formatActivitiesAsReasoning([
  { sequence: 1, summary: '预测市场广搜完成' },
  {
    sequence: 2,
    summary: '编排检索已更新：16 个候选',
    crumb: '[polymarket] Will Fed cut?',
  },
])
assert(reasoning.includes('### 预测市场广搜完成'), 'summary becomes heading')
assert(
  reasoning.includes('[polymarket] Will Fed cut?'),
  'crumb becomes body under heading'
)
assert(
  !reasoning.includes('### 编排检索已更新：16 个候选\n\n###'),
  'crumb section should not be heading-only'
)

assert(
  summarizeSubagentEvent('subagent.started', { kind: 'news' }).includes(
    '新闻猎手'
  ),
  'subagent started should use alias'
)
assert(
  summarizeSubagentEvent('subagent.completed', {
    kind: 'polymarket',
    itemCount: 8,
  }).includes('行情侦察') &&
    summarizeSubagentEvent('subagent.completed', {
      kind: 'polymarket',
      itemCount: 8,
    }).includes('8 条'),
  'subagent completed should include alias and item count'
)
assert(
  summarizeSubagentEvent('subagent.failed', {
    kind: 'world_monitor',
    errorMessage: 'timeout',
  }).includes('全球瞭望') &&
    summarizeSubagentEvent('subagent.failed', {
      kind: 'world_monitor',
      errorMessage: 'timeout',
    }).includes('timeout'),
  'subagent failed should surface alias and error'
)
assert(
  summarizeSubagentEvent('subagent.fanout', {
    kinds: ['polymarket', 'world_monitor', 'pandaai', 'news', 'web'],
  }).includes('主理人派出'),
  'fanout should narrate main agent dispatch'
)
assert(
  summarizeSubagentEvent('subagent.fanin', {}).includes('情报官'),
  'fanin should mention synthesizer alias'
)

console.log('activitySummaries smoke tests passed')
