import { SubagentBadge } from '@/features/agent/components/SubagentBadge'
import { INTEL_SUBAGENT_KINDS } from '@/features/agent/subagentIdentity'
import type { AgentSubagent, AgentSubagentStatus } from '@/features/agent/types'
import { cn } from '@/lib/utils'

function statusOf(
  byKind: Map<string, AgentSubagent>,
  kind: string
): AgentSubagentStatus {
  return byKind.get(kind)?.status ?? 'pending'
}

function isTerminal(status: AgentSubagentStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'skipped'
}

function isActive(status: AgentSubagentStatus): boolean {
  return status === 'running' || isTerminal(status)
}

export function SubagentDispatchTheater({
  subagents = [],
  className,
}: {
  subagents?: AgentSubagent[]
  className?: string
}) {
  const byKind = new Map(subagents.map((row) => [row.kind, row]))

  // Phase 1: Intel sources
  const intelStatuses = INTEL_SUBAGENT_KINDS.map((kind) =>
    statusOf(byKind, kind)
  )
  const anyIntelDispatched = intelStatuses.some(isActive)
  const intelDone = intelStatuses.every(isTerminal)
  const intelRunning = intelStatuses.filter((s) => s === 'running').length
  const intelCompleted = intelStatuses.filter(isTerminal).length

  // Phase 2: Polymarket (informed by intel)
  const polyStatus = statusOf(byKind, 'polymarket')
  const polyLit = intelDone || isActive(polyStatus)

  // Phase 3: Synthesizer
  const synthStatus = statusOf(byKind, 'synthesizer')
  const synthLit = (intelDone && isTerminal(polyStatus)) || isActive(synthStatus)

  let narrative = '主理人正在准备派出情报员…'
  if (synthStatus === 'succeeded') {
    narrative = '情报官已完成汇总，准备进入方案编排'
  } else if (synthStatus === 'running') {
    narrative = '全源调查已汇集，情报官正在汇总'
  } else if (isTerminal(polyStatus) && intelDone) {
    narrative = '情报采集与市场检索已完成，即将汇总'
  } else if (polyStatus === 'running') {
    narrative = '情报已归集，正在关联预测市场'
  } else if (intelDone) {
    narrative = '情报采集完成，开始关联预测市场'
  } else if (anyIntelDispatched) {
    narrative = `主理人已派出情报员 · 进行中 ${intelRunning} · 完成 ${intelCompleted}/${INTEL_SUBAGENT_KINDS.length}`
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] px-3 py-3 md:px-4',
        className
      )}
      aria-label="主理人派发调查"
    >
      <p className="text-[12.5px] font-medium text-muted-foreground">
        派发调查
      </p>
      <p className="mt-0.5 text-[13.5px] leading-relaxed text-foreground">
        {narrative}
      </p>

      <div className="mt-3 flex flex-col items-stretch gap-1.5">
        {/* Main Agent */}
        <div
          className={cn(
            'units-stage-enter mx-auto flex w-fit justify-center rounded-full border border-[var(--units-stroke-color)] bg-background/80 px-3 py-1.5',
            anyIntelDispatched && 'ring-1 ring-[color-mix(in_srgb,var(--units-orange)_22%,transparent)]'
          )}
        >
          <SubagentBadge mainAgent showRole size="md" />
        </div>

        {/* Connector: Main -> Intel */}
        <div
          aria-hidden
          className={cn(
            'mx-auto h-3 w-px transition-colors duration-500 motion-reduce:transition-none',
            anyIntelDispatched
              ? 'bg-[var(--units-orange)]'
              : 'bg-[color-mix(in_srgb,var(--units-black)_16%,transparent)]'
          )}
        />

        {/* Phase 1: Intel sources (3 columns) */}
        <div>
          <p className="mb-1 text-center text-[10px] font-medium text-muted-foreground">
            情报采集
          </p>
          <ul className="grid grid-cols-3 gap-1.5">
            {INTEL_SUBAGENT_KINDS.map((kind, index) => {
              const status = statusOf(byKind, kind)
              const lit = isActive(status)
              return (
                <li
                  key={kind}
                  className={cn(
                    'units-stage-enter rounded-xl border border-[var(--units-stroke-color)] bg-background/70 px-2 py-2',
                    lit &&
                      'border-[color-mix(in_srgb,var(--units-orange)_28%,transparent)]'
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <SubagentBadge
                    kind={kind}
                    status={status}
                    size="sm"
                    showRole
                    dimmed={!lit && anyIntelDispatched}
                  />
                </li>
              )
            })}
          </ul>
        </div>

        {/* Connector: Intel -> Polymarket */}
        <div
          aria-hidden
          className={cn(
            'mx-auto h-3 w-px transition-colors duration-500 motion-reduce:transition-none',
            polyLit
              ? 'bg-[var(--units-blue)]'
              : 'bg-[color-mix(in_srgb,var(--units-black)_16%,transparent)]'
          )}
        />

        {/* Phase 2: Polymarket (informed by intel) */}
        <div>
          <p className="mb-1 text-center text-[10px] font-medium text-muted-foreground">
            关联预测市场
          </p>
          <div
            className={cn(
              'units-stage-enter mx-auto w-fit rounded-xl border border-[var(--units-stroke-color)] bg-background/70 px-3 py-2',
              isActive(polyStatus) &&
                'border-[color-mix(in_srgb,var(--units-blue)_28%,transparent)]',
              !polyLit && anyIntelDispatched && 'opacity-55'
            )}
            style={{ animationDelay: '150ms' }}
          >
            <SubagentBadge
              kind="polymarket"
              status={polyStatus}
              size="md"
              showRole
              dimmed={!polyLit}
            />
          </div>
        </div>

        {/* Connector: Polymarket -> Synthesizer */}
        <div
          aria-hidden
          className={cn(
            'mx-auto h-3 w-px transition-colors duration-500 motion-reduce:transition-none',
            synthLit
              ? 'bg-[var(--units-orange)]'
              : 'bg-[color-mix(in_srgb,var(--units-black)_16%,transparent)]'
          )}
        />

        {/* Phase 3: Synthesizer */}
        <div
          className={cn(
            'units-stage-enter mx-auto flex w-fit justify-center rounded-full border border-[var(--units-stroke-color)] bg-background/80 px-3 py-1.5',
            synthLit &&
              'ring-1 ring-[color-mix(in_srgb,var(--units-orange)_22%,transparent)]',
            !synthLit && anyIntelDispatched && 'opacity-55'
          )}
          style={{ animationDelay: '200ms' }}
        >
          <SubagentBadge
            kind="synthesizer"
            status={synthStatus}
            size="md"
            showRole
            dimmed={!synthLit}
          />
        </div>
      </div>
    </section>
  )
}
