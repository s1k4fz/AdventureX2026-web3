import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  SearchX,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  CJK_SCRAMBLE_CHARS,
  DecryptedText,
} from '@/components/DecryptedText'
import { PolicyCommandRetry } from '@/features/agent/artifacts/PolicyCommandRetry'
import {
  briefSummary,
  citationList,
  itemCount,
  progressPhaseLabel,
} from '@/features/agent/subagentBrief'
import {
  INTEL_SUBAGENT_KINDS,
  getSubagentIdentity,
  subagentAlias,
} from '@/features/agent/subagentIdentity'
import type { AgentSubagent, AgentSubagentStatus } from '@/features/agent/types'
import { SUBAGENT_KIND_ORDER, SUBAGENT_STATUS_LABELS } from '@/features/agent/types'
import { GlobalContextPanel } from '@/features/policy/GlobalContextPanel'
import type { MarketSearchProgress } from '@/features/policy/streamPolicyCompose'
import { cn } from '@/lib/utils'

import { AgentTeamStrip } from '../components/AgentTeamStrip'
import { StageLiveStatus } from '../components/StageLiveStatus'
import { StageShell } from '../components/StageShell'
import { SubagentDispatchTheater } from '../components/SubagentDispatchTheater'
import { SubagentLanes, subagentProgressLabel } from '../components/SubagentLanes'
import type { ModelExplanation, StageStatus } from '../types'

const MATCHING_HINTS = [
  '正在连接 Polymarket 等预测市场…',
  '正在检索与你的风险相关的事件…',
  '正在按流动性与相关度筛选候选…',
  '命中的市场会实时出现在下方…',
]

/** Citations already gathered by intel lanes, shown while markets are pending. */
function collectIntelSignals(subagents: AgentSubagent[]) {
  const seen = new Set<string>()
  return subagents
    .filter((row) => row.kind !== 'polymarket')
    .flatMap((row) =>
      citationList(row).map((citation, index) => ({
        key: `${row.id}-${index}`,
        alias: subagentAlias(row.kind),
        citation,
      }))
    )
    .filter(({ citation }) => {
      const dedupeKey = citation.url || citation.title
      if (!dedupeKey || seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
}

/**
 * Fills the market-candidate slot with real intel while markets are pending:
 * citations from news/web/macro lanes first, live lane activity otherwise.
 * Intentionally no skeleton rows — the wait should read as progress, not blanks.
 */
function IntelWarmupFeed({ subagents }: { subagents: AgentSubagent[] }) {
  const signals = collectIntelSignals(subagents).slice(0, 6)

  if (signals.length > 0) {
    return (
      <section
        aria-label="已采集的风险信号"
        className="rounded-2xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_40%,transparent)] px-3.5 py-3"
      >
        <p className="text-[12px] font-semibold text-muted-foreground">
          等待市场命中期间，先看看已采集到的风险信号
        </p>
        <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
          {signals.map(({ key, alias, citation }) => {
            const body = (
              <>
                <span className="shrink-0 rounded-full border border-[var(--units-stroke-color)] bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {alias}
                </span>
                <span className="min-w-0 flex-1 truncate">{citation.title}</span>
              </>
            )
            const rowClass =
              'units-stage-enter flex min-h-8 w-full items-center gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-background px-2.5 py-1.5 text-[13px] font-medium text-foreground'
            return (
              <li key={key} className="min-w-0">
                {citation.url ? (
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={citation.title}
                    className={`${rowClass} hover:border-[var(--units-stroke-strong)]`}
                  >
                    {body}
                  </a>
                ) : (
                  <div title={citation.title} className={rowClass}>
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  const activeLanes = subagents.filter(
    (row) => row.kind !== 'polymarket' && row.status !== 'skipped'
  )
  if (activeLanes.length === 0) return null

  return (
    <section
      aria-label="情报源实时动态"
      className="rounded-2xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_40%,transparent)] px-3.5 py-3"
    >
      <p className="text-[12px] font-semibold text-muted-foreground">
        等待市场命中期间，情报源正在并行工作
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {activeLanes.map((row) => {
          const detail = progressPhaseLabel(row) || briefSummary(row)
          return (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-background px-2.5 py-1.5"
            >
              <span className="shrink-0">{statusIcon(row.status)}</span>
              <span className="shrink-0 text-[12.5px] font-medium text-foreground">
                {subagentAlias(row.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                {detail}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MarketHitCapsule({
  item,
}: {
  item: {
    platform: string
    question: string
    volume: number | null
    url?: string | null
  }
}) {
  const content = (
    <>
      <span className="size-[16px] shrink-0 rounded-full bg-[var(--units-blue)] text-center text-[9px] leading-4 font-bold text-white">
        {item.platform.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.question}</span>
      {item.volume != null && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          vol {item.volume.toLocaleString()}
        </span>
      )}
    </>
  )
  const className =
    'units-stage-enter flex min-h-8 w-full items-center gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-background px-2.5 py-1.5 text-[13px] font-medium text-foreground'

  if (item.url) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        title={item.question}
        className={`${className} hover:border-[var(--units-stroke-strong)]`}
      >
        {content}
      </a>
    )
  }

  return (
    <div title={item.question} className={className}>
      {content}
    </div>
  )
}

function statusIcon(status: AgentSubagentStatus) {
  if (status === 'succeeded') {
    return <CheckCircle2 className="size-3.5 text-emerald-500" />
  }
  if (status === 'failed') {
    return <XCircle className="size-3.5 text-destructive" />
  }
  if (status === 'running') {
    return (
      <Loader2 className="size-3.5 animate-spin text-[var(--units-orange)]" />
    )
  }
  if (status === 'skipped') {
    return <Circle className="size-3.5 text-muted-foreground/50" />
  }
  return <Circle className="size-3.5 text-muted-foreground/40" />
}

function SourceStatusBoard({ subagents }: { subagents: AgentSubagent[] }) {
  const byKind = new Map(subagents.map((row) => [row.kind, row]))
  return (
    <section
      className="rounded-2xl border border-[var(--units-stroke-color)] bg-background px-3.5 py-3"
      aria-label="各源调查状态"
    >
      <p className="text-[12.5px] font-semibold text-foreground">各源状态</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        情报源与行情侦察的实时进度、命中数与重试
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {SUBAGENT_KIND_ORDER.map((kind) => {
          const row = byKind.get(kind)
          const status = row?.status ?? 'pending'
          const phase = progressPhaseLabel(row)
          const count = itemCount(row)
          const summary = briefSummary(row)
          const rounds =
            row?.brief?.meta &&
            typeof row.brief.meta === 'object' &&
            typeof (row.brief.meta as { roundsAttempted?: unknown })
              .roundsAttempted === 'number'
              ? (row.brief.meta as { roundsAttempted: number }).roundsAttempted
              : null
          return (
            <li
              key={kind}
              className="flex items-start gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_40%,transparent)] px-2.5 py-2"
            >
              <span className="mt-0.5 shrink-0">{statusIcon(status)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[13px] font-medium text-foreground">
                    {subagentAlias(kind)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {getSubagentIdentity(kind).role}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {SUBAGENT_STATUS_LABELS[status]}
                  </span>
                  {count > 0 ? (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {count} 条
                    </span>
                  ) : null}
                  {rounds != null && rounds > 1 ? (
                    <span className="text-[11px] text-muted-foreground">
                      探索 {rounds} 轮
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {phase && phase !== summary ? `${phase} · ${summary}` : summary}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ResearchTimeline({
  subagents,
  latestExplanation,
  hasItems,
  totalCount,
  isLoading,
}: {
  subagents: AgentSubagent[]
  latestExplanation?: ModelExplanation | null
  hasItems: boolean
  totalCount: number
  isLoading: boolean
}) {
  const byKind = new Map(subagents.map((row) => [row.kind, row]))
  const intelStatuses = INTEL_SUBAGENT_KINDS.map(
    (kind) => byKind.get(kind)?.status ?? 'pending'
  )
  const intelDone = intelStatuses.every(
    (s) => s === 'succeeded' || s === 'failed' || s === 'skipped'
  )
  const intelRunning = intelStatuses.some((s) => s === 'running')
  const intelStarted = intelStatuses.some((s) => s !== 'pending')
  const poly = byKind.get('polymarket')
  const synth = byKind.get('synthesizer')

  const steps = useMemo(() => {
    const polyPhase = progressPhaseLabel(poly)
    const polyRunning = poly?.status === 'running'
    const polyDone =
      poly?.status === 'succeeded' ||
      poly?.status === 'failed' ||
      poly?.status === 'skipped'
    const synthDone =
      synth?.status === 'succeeded' ||
      synth?.status === 'failed' ||
      synth?.status === 'skipped'

    return [
      {
        key: 'match',
        label: '匹配可保障事件',
        detail: hasItems
          ? `已找到 ${totalCount} 个真实市场候选`
          : polyRunning
            ? polyPhase || '正在搜索与风险相关的真实市场'
            : polyDone
              ? briefSummary(poly)
              : '准备连接预测市场',
        done: hasItems || poly?.status === 'succeeded',
        current: polyRunning,
      },
      {
        key: 'validate',
        label: '校验风险信号',
        detail: intelRunning
          ? '新闻、宏观与网页信号正在并行校验'
          : intelDone
            ? '辅助信号已完成校验；失败来源不会阻塞方案'
            : '与市场匹配同时启动，不增加串行等待',
        done: intelDone,
        current: intelRunning || (intelStarted && !intelDone),
      },
      {
        key: 'plan',
        label: '形成方案依据',
        detail:
          synth?.status === 'running'
            ? '正在归纳候选与风险信号'
            : synthDone
              ? '依据已就绪，即将生成三档保障方案'
              : latestExplanation?.summary || '市场匹配后自动开始',
        done: synthDone,
        current: synth?.status === 'running',
      },
    ]
  }, [
    hasItems,
    intelDone,
    intelRunning,
    intelStarted,
    latestExplanation?.summary,
    poly,
    synth,
    totalCount,
  ])

  const completed = steps.filter((s) => s.done).length
  const progressPct = Math.max(
    8,
    Math.round(((completed + (isLoading ? 0.35 : 0)) / steps.length) * 100)
  )

  return (
    <section
      className="rounded-2xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] px-3.5 py-3"
      aria-label="情报作战时间线"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-semibold text-foreground">
            方案准备进度
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            市场匹配与风险校验并行执行；辅助来源异常不会卡住流程
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {completed}/{steps.length}
        </span>
      </div>
      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-[var(--units-orange)] transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              {step.done ? (
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              ) : step.current ? (
                <Loader2 className="size-3.5 animate-spin text-[var(--units-orange)]" />
              ) : (
                <Circle className="size-3.5 text-muted-foreground/40" />
              )}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[13px] font-medium',
                  step.done || step.current
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {step.label}
              </p>
              <p className="text-[12px] text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LaneDetails({
  subagents,
  open,
  onToggle,
}: {
  subagents: AgentSubagent[]
  open: boolean
  onToggle: () => void
}) {
  if (subagents.length === 0) return null
  const progressLabel = subagentProgressLabel(subagents)

  return (
    <div className="rounded-xl border border-[var(--units-stroke-color)] bg-background">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
      >
        <span className="text-[13px] font-semibold text-foreground">
          查看技术细节
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {progressLabel
            ? `${progressLabel} · 数据源、检索轮次与引用`
            : '数据源、检索轮次与引用'}
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-[var(--units-stroke-color)] px-3.5 py-3">
          <SubagentDispatchTheater subagents={subagents} />
          <SourceStatusBoard subagents={subagents} />
          <SubagentLanes subagents={subagents} showHeading={false} />
        </div>
      ) : null}
    </div>
  )
}

export interface MarketResearchStageProps {
  title: string
  search?: MarketSearchProgress | null
  subagents?: AgentSubagent[]
  latestExplanation?: ModelExplanation | null
  stageStatus?: StageStatus
  errorMessage?: string | null
  onReviseGoal?: () => void
  taskId?: string
}

export function MarketResearchStage({
  title,
  search = null,
  subagents = [],
  latestExplanation = null,
  stageStatus = 'loading',
  errorMessage,
  onReviseGoal,
  taskId,
}: MarketResearchStageProps) {
  const items = search?.items ?? []
  const totalCount = search?.totalCount ?? items.length
  const hasItems = items.length > 0
  const isLoading = stageStatus === 'loading' || stageStatus === 'retry'
  const [laneDetailsOpen, setLaneDetailsOpen] = useState(false)
  const noMatch =
    !hasItems &&
    (stageStatus === 'success' || stageStatus === 'failed')
  const statusSummary = latestExplanation?.summary?.trim()
  const hasWorldBrief = subagents.some(
    (row) =>
      row.kind === 'world_monitor' &&
      (row.status === 'succeeded' || row.status === 'failed')
  )
  const platformLabel =
    search?.platforms
      ?.map((row) => `${row.platform} ${row.count}`)
      .join(' · ') ?? null

  if (noMatch) {
    const failed = stageStatus === 'failed'
    return (
      <StageShell
        stage="market_research"
        title={failed ? '市场检索失败' : '未找到可用市场'}
        description={
          errorMessage ??
          statusSummary ??
          (failed
            ? '检索服务暂时不可用，请稍后重试或调整风险描述。'
            : '服务调用成功，但当前关键词下没有可投保的预测市场。请调整描述后重试。')
        }
      >
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--units-stroke-color)] bg-background px-5 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)]">
              {failed ? (
                <AlertTriangle className="size-4 text-destructive" />
              ) : (
                <SearchX className="size-4 text-[var(--units-orange)]" />
              )}
            </span>
            <p className="min-w-0 text-[14px] leading-relaxed text-muted-foreground">
              可以缩小时间范围、换用更常见的标的名称，或补充一句更具体的风险场景。
            </p>
          </div>
          {taskId && failed ? (
            <PolicyCommandRetry taskId={taskId} />
          ) : onReviseGoal ? (
            <Button
              type="button"
              className="units-cta h-11 w-fit rounded-xl px-5 text-[14px] font-semibold shadow-none"
              onClick={onReviseGoal}
            >
              修改风险描述
            </Button>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              可在底部指令栏补充要求，从安全检查点重新检索。
            </p>
          )}
        </div>
      </StageShell>
    )
  }

  return (
    <StageShell
      stage="market_research"
      measure="board"
      title={
        stageStatus === 'success' ? (
          '情报采集完成'
        ) : stageStatus === 'failed' ? (
          '情报采集中断'
        ) : (
          <DecryptedText
            text="正在采集可投保的市场情报"
            animateOn="view"
            sequential
            speed={40}
            characters={CJK_SCRAMBLE_CHARS}
            encryptedClassName="text-muted-foreground/50"
          />
        )
      }
      description={title}
      aside={
        hasItems ? (
          <span className="rounded-full border border-[var(--units-stroke-color)] bg-background px-2.5 py-1 text-[12px] font-semibold tabular-nums text-muted-foreground">
            候选 {totalCount} 条
          </span>
        ) : null
      }
      headerBelow={
        isLoading ? (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
            aria-hidden
          >
            <div className="units-loading-bar-fill h-full w-1/3 rounded-full bg-[var(--units-orange)]" />
          </div>
        ) : undefined
      }
    >
      {statusSummary ? (
        <p className="text-[13.5px] leading-relaxed text-foreground">
          {statusSummary}
        </p>
      ) : null}

      <AgentTeamStrip
        subagents={subagents}
        onOpenDetails={() => setLaneDetailsOpen(true)}
      />

      <ResearchTimeline
        subagents={subagents}
        latestExplanation={latestExplanation}
        hasItems={hasItems}
        totalCount={totalCount}
        isLoading={isLoading}
      />

      <section className="flex flex-col gap-2.5" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {!hasItems && isLoading ? (
              <StageLiveStatus
                hints={MATCHING_HINTS}
                note="辅助信号并行校验，不会拖慢市场匹配"
              />
            ) : (
              <p className="text-[12.5px] font-medium text-muted-foreground">
                {hasItems ? `全部候选 · ${totalCount} 条` : '暂无预测市场命中'}
              </p>
            )}
            {hasItems && platformLabel ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {platformLabel}
                {items.length !== totalCount
                  ? ` · 列表 ${items.length} 条`
                  : ' · 已全部纳入方案编排考虑'}
              </p>
            ) : null}
          </div>
        </div>
        {hasItems ? (
          <div className="max-h-[min(28rem,55vh)] overflow-y-auto pr-0.5">
            <div className="grid gap-1.5 md:grid-cols-2">
              {items.map((item, index) => (
                <MarketHitCapsule
                  key={`${item.platform}-${item.conditionId ?? index}-${item.question}`}
                  item={item}
                />
              ))}
            </div>
          </div>
        ) : isLoading ? (
          <IntelWarmupFeed subagents={subagents} />
        ) : null}
      </section>

      <LaneDetails
        subagents={subagents}
        open={laneDetailsOpen}
        onToggle={() => setLaneDetailsOpen((value) => !value)}
      />

      {!hasWorldBrief ? <GlobalContextPanel /> : null}

      {errorMessage ? (
        <p className="text-[14px] text-destructive">{errorMessage}</p>
      ) : null}
    </StageShell>
  )
}
