import { ChevronDown } from 'lucide-react'

import {
  AgentInput,
  type AgentInputPayload,
} from '@/components/AgentInput'
import type { HomeDashboardStats } from '@/features/home/HomeDashboardMetrics'

interface PromptHint {
  tag: string
  color: string
  text: string
}

const PROMPT_HINTS: readonly PromptHint[] = [
  {
    tag: '利率',
    color: 'var(--units-blue)',
    text: '担心美联储年内降息次数不及预期，想对冲利率路径风险',
  },
  {
    tag: '能源',
    color: 'var(--units-orange)',
    text: '担心未来 90 天油价剧烈波动影响出行成本',
  },
  {
    tag: '加密',
    color: 'var(--units-lilac)',
    text: '想对冲 ETH 短期内大幅回调的风险',
  },
  {
    tag: '汇率',
    color: 'var(--units-green)',
    text: '担心人民币汇率持续走弱，出国留学成本上升',
  },
] as const

const FLOW_STEPS = [
  '描述担忧',
  '风险问卷',
  '检索市场',
  '三档方案',
  '链上出资',
  '到期结算',
] as const

interface HomeHeroSectionProps {
  draft: string
  onDraftChange: (value: string) => void
  onSendTask: (payload: AgentInputPayload) => void
  taskError?: string | null
  stats: HomeDashboardStats
  formattedCoverage: string
  onBrowsePanel: () => void
  onFocusPending: () => void
}

export function HomeHeroSection({
  draft,
  onDraftChange,
  onSendTask,
  taskError,
  stats,
  formattedCoverage,
  onBrowsePanel,
  onFocusPending,
}: HomeHeroSectionProps) {
  const handleHintClick = (hint: PromptHint) => {
    onDraftChange(hint.text)
  }

  const hasPortfolio = stats.activeCount > 0 || stats.pendingSettle > 0

  return (
    <section className="relative flex min-h-full shrink-0 flex-col items-center justify-center overflow-hidden px-6">
      {/* Subtle color glows echoing the units accent palette */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--units-blue)_12%,transparent),transparent)]" />
        <div className="absolute right-[8%] top-[30%] h-64 w-64 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--units-orange)_9%,transparent),transparent)]" />
        <div className="absolute bottom-[14%] left-[8%] h-56 w-56 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--units-lilac)_9%,transparent),transparent)]" />
      </div>

      <div className="units-stagger relative w-full max-w-2xl space-y-6 pb-16 pt-10">
        <div className="space-y-3 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--units-stroke-color)] bg-background/80 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">
            <img src="/logo.svg" alt="" className="size-4 rounded-[4px]" />
            xEngine · 差分机
          </span>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
            把一句担忧，
            <span className="text-[var(--units-orange)]">变成链上保障</span>
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            描述你的担忧，Agent 会生成风险问卷、检索预测市场，并编排三档可签约的保障方案。
          </p>
        </div>

        <div>
          <AgentInput
            value={draft}
            variant="home"
            onValueChange={onDraftChange}
            onSend={onSendTask}
            placeholder="描述你的担忧，例如：担心美联储降息预期落空…"
            modeLabel="风险 Agent"
          />
          {taskError ? (
            <p className="units-text-caption mt-2 rounded-[var(--units-radius-sm)] border border-[var(--units-red)] bg-[color-mix(in_srgb,var(--units-red)_10%,transparent)] px-2.5 py-1.5 text-center text-[var(--units-red)]">
              {taskError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {PROMPT_HINTS.map((hint) => (
            <button
              key={hint.tag}
              type="button"
              onClick={() => handleHintClick(hint)}
              className="units-text-caption group inline-flex items-center gap-1.5 rounded-full border border-[var(--units-stroke-color)] bg-background/80 py-1.5 pl-2.5 pr-3 text-muted-foreground transition-colors hover:border-[var(--units-stroke-strong)] hover:text-foreground"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: hint.color }}
              />
              <span className="font-semibold text-foreground/80 group-hover:text-foreground">
                {hint.tag}
              </span>
              <span className="max-w-[13rem] truncate">{hint.text}</span>
            </button>
          ))}
        </div>

        {/* Live portfolio strip: only shown once the user has policies */}
        {hasPortfolio ? (
          <button
            type="button"
            onClick={stats.pendingSettle > 0 ? onFocusPending : onBrowsePanel}
            className="mx-auto flex items-center gap-2.5 rounded-full border border-[var(--units-stroke-color)] bg-background/80 px-4 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--units-stroke-strong)] hover:text-foreground"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--units-green)] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--units-green)]" />
            </span>
            <span>
              生效 <span className="font-semibold text-foreground">{stats.activeCount}</span> 份
            </span>
            <span aria-hidden className="text-[var(--units-stroke-strong)]">·</span>
            <span>
              在保 <span className="font-semibold text-foreground">{formattedCoverage}</span>
            </span>
            {stats.pendingSettle > 0 ? (
              <>
                <span aria-hidden className="text-[var(--units-stroke-strong)]">·</span>
                <span className="font-semibold text-[var(--units-orange)]">
                  {stats.pendingSettle} 份待结算
                </span>
              </>
            ) : null}
          </button>
        ) : null}

        {/* Thin flow strip: how a policy comes to life */}
        <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground/80">
          {FLOW_STEPS.map((step, index) => (
            <li key={step} className="flex list-none items-center gap-1.5">
              <span className="flex items-center gap-1">
                <span className="text-[10px] font-semibold text-muted-foreground/50">
                  {index + 1}
                </span>
                {step}
              </span>
              {index < FLOW_STEPS.length - 1 ? (
                <span aria-hidden className="text-[var(--units-stroke-strong)]">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {/* Scroll cue into the dashboard section */}
      <button
        type="button"
        onClick={onBrowsePanel}
        className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        下滑查看保障面板
        <ChevronDown className="size-4 motion-safe:animate-bounce" />
      </button>
    </section>
  )
}
