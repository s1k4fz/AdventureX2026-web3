/**
 * Throwaway visual harness for the policy journey (served via /preview.html).
 * Not referenced by the app router; safe to delete.
 */
import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import './index.css'

import { queryClient } from '@/lib/queryClient'
import type { AgentSubagent } from '@/features/agent/types'
import { createEmptyJourneyState } from '@/features/policy-journey/journeyReducer'
import { PolicyJourneyShell } from '@/features/policy-journey/PolicyJourneyShell'
import type {
  JourneyStage,
  PolicyJourneyState,
} from '@/features/policy-journey/types'
import type { QuestionnaireQuestion } from '@/features/policy/policyApi'

const now = new Date().toISOString()

const subagents: AgentSubagent[] = [
  {
    id: 's1',
    kind: 'polymarket',
    status: 'succeeded',
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    brief: { summary: '命中 6 个 BTC 相关市场', resultCount: 6 },
  },
  {
    id: 's2',
    kind: 'world_monitor',
    status: 'running',
    createdAt: now,
    startedAt: now,
  },
  {
    id: 's3',
    kind: 'news',
    status: 'succeeded',
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    brief: {
      summary: '命中 3 条相关新闻',
      citations: [
        {
          title: 'ETF 资金连续五日净流出，BTC 短期承压',
          url: 'https://example.com/etf-outflow',
        },
        {
          title: '美联储会议纪要释放鹰派信号，风险资产波动加剧',
          url: 'https://example.com/fomc-minutes',
        },
        {
          title: '链上清算量创两个月新高，杠杆多头风险上升',
          url: 'https://example.com/liquidation',
        },
      ],
    },
  },
  { id: 's4', kind: 'web', status: 'pending', createdAt: now },
  { id: 's5', kind: 'synthesizer', status: 'pending', createdAt: now },
]

const questions: QuestionnaireQuestion[] = [
  {
    id: 'q1',
    title: '你最担心哪一段时间内的价格回撤？',
    options: ['未来 2 周', '未来 1 个月', '未来 3 个月', '未来半年'],
  },
  {
    id: 'q2',
    title: '可接受的保费负担大概是多少？',
    options: ['尽量低', '中等', '可为更高赔付加码'],
  },
  {
    id: 'q3',
    title: '触发赔付的回撤幅度希望设在？',
    options: ['-10%', '-20%', '-30%'],
  },
]

const factorCategories = [
  { id: 'f1', label: '价格回撤', rationale: '标的在 30 日窗口内波动率处于高位。' },
  { id: 'f2', label: '流动性收缩', rationale: '主要交易场所深度下降，滑点风险上升。' },
  { id: 'f3', label: '监管事件', rationale: '存在待定的监管听证日程。' },
]

type Scenario = {
  id: string
  label: string
  journey: PolicyJourneyState
  generating?: boolean
  withQuestions?: boolean
}

function stagesUpTo(
  stage: JourneyStage,
  status: PolicyJourneyState['stages'][JourneyStage] = 'loading'
): PolicyJourneyState['stages'] {
  const order: JourneyStage[] = [
    'needs',
    'risk_profile',
    'market_research',
    'coverage_plan',
    'on_chain_active',
  ]
  const index = order.indexOf(stage)
  const out = {} as PolicyJourneyState['stages']
  order.forEach((key, i) => {
    out[key] = i < index ? 'success' : i === index ? status : 'idle'
  })
  return out
}

const scenarios: Scenario[] = [
  {
    id: 'generating',
    label: '① 生成问卷中',
    generating: true,
    journey: createEmptyJourneyState({
      currentStage: 'needs',
      stages: stagesUpTo('needs', 'loading'),
      subagents,
    }),
  },
  {
    id: 'generating-factors',
    label: '② 生成中（已出因子）',
    generating: true,
    journey: createEmptyJourneyState({
      currentStage: 'needs',
      stages: stagesUpTo('needs', 'loading'),
      subagents,
    }),
  },
  {
    id: 'questionnaire',
    label: '③ 问卷作答',
    withQuestions: true,
    journey: createEmptyJourneyState({
      currentStage: 'needs',
      stages: stagesUpTo('needs', 'waiting_confirmation'),
      subagents,
    }),
  },
  {
    id: 'research',
    label: '④ 采集情报',
    journey: createEmptyJourneyState({
      currentStage: 'market_research',
      stages: stagesUpTo('market_research', 'loading'),
      subagents,
      search: {
        platforms: [{ platform: 'polymarket', count: 4 }],
        items: [
          {
            platform: 'polymarket',
            question: 'Will BTC close below $80k before Sep 30?',
            volume: 2_410_000,
            endDate: null,
          },
          {
            platform: 'polymarket',
            question: 'Will ETH/BTC drop under 0.03 in Q3?',
            volume: 880_000,
            endDate: null,
          },
          {
            platform: 'kalshi',
            question: 'Fed cuts rates at September meeting?',
            volume: 1_250_000,
            endDate: null,
          },
        ],
      },
    }),
  },
  {
    id: 'research-waiting',
    label: '⑤ 采集中（市场未命中）',
    journey: createEmptyJourneyState({
      currentStage: 'market_research',
      stages: stagesUpTo('market_research', 'loading'),
      subagents,
      search: null,
    }),
  },
]

function Preview() {
  const [scenarioId, setScenarioId] = useState(scenarios[0]!.id)
  const [answers, setAnswers] = useState<Record<string, string | null>>({})
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]!

  return (
    <div className="flex h-dvh flex-col bg-[var(--units-cream)]">
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-[var(--units-stroke-color)] px-4 py-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScenarioId(s.id)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${
              s.id === scenarioId
                ? 'border-[var(--units-black)] bg-[var(--units-black)] text-[var(--units-cream)]'
                : 'border-[var(--units-stroke-color)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 p-4">
        <PolicyJourneyShell
          fillHeight
          title="BTC 三个月内回撤 20% 的保障"
          journey={scenario.journey}
          taskStatus="running"
          questions={scenario.withQuestions ? questions : []}
          factorCategories={
            scenario.id === 'generating' ? [] : factorCategories
          }
          answers={answers}
          isGeneratingQuestionnaire={scenario.generating}
          onAnswerChange={(questionId, option) =>
            setAnswers((current) => ({
              ...current,
              [questionId]: current[questionId] === option ? null : option,
            }))
          }
          onApplyAnswers={setAnswers}
          onSubmitAnswers={() => undefined}
          onRetryGenerate={() => undefined}
          onUseBasicQuestionnaire={() => undefined}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Preview />
    </BrowserRouter>
  </QueryClientProvider>
)
