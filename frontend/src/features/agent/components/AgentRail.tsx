import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  XCircle,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { latestRun } from '../eventReducer'
import {
  POLICY_STEP_LABELS,
  type AgentActivityItem,
  type AgentApproval,
  type AgentTaskDetail,
} from '../types'

function StepIcon({ status }: { status: string }) {
  if (status === 'succeeded') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--units-green)_18%,transparent)]">
        <CheckCircle2 className="size-3.5 text-[var(--units-green)]" />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--units-red)_14%,transparent)]">
        <XCircle className="size-3.5 text-[var(--units-red)]" />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="relative flex size-5 items-center justify-center rounded-full bg-[var(--units-orange)]">
        <LoaderCircle className="size-3 animate-spin text-[var(--units-on-accent)]" />
      </span>
    )
  }
  return <Circle className="size-2.5 text-[color-mix(in_srgb,var(--units-black)_22%,transparent)]" />
}

export function AgentRail({
  task,
  activities: _activities,
  pendingApprovals,
  compact = false,
  className,
}: {
  task: AgentTaskDetail
  activities: AgentActivityItem[]
  pendingApprovals: AgentApproval[]
  /** Slim flow-only rail (used in mobile sheet). Activity lives in ResearchDrawer. */
  compact?: boolean
  className?: string
}) {
  void _activities
  const run = latestRun(task)
  const steps = run?.steps ?? []
  const blocking =
    pendingApprovals[0]?.kind === 'intake_answers'
      ? '请完成风险问卷'
      : pendingApprovals[0]?.kind === 'select_portfolio'
        ? '请选择保障档位'
        : pendingApprovals[0]?.kind === 'confirm_funding'
          ? '请确认链上出资'
          : null

  return (
    <aside
      aria-label="任务流程"
      data-compact={compact ? 'true' : 'false'}
      className={cn(
        'units-workspace-pane flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] px-4">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-5">{task.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {pendingApprovals.length > 0 ? '进行中 · 等待你' : '进行中'}
          </p>
        </div>
      </div>

      <div className="scrollbar-fade min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {pendingApprovals.length > 0 ? (
          <section className="mb-4 rounded-xl bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)] px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--units-orange)] uppercase">
              当前阻塞
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {pendingApprovals.map((approval) => (
                <li key={approval.id} className="text-[13px] font-medium">
                  {approval.kind === 'intake_answers'
                    ? '填写风险问卷'
                    : approval.kind === 'select_portfolio'
                      ? '选择保障档位'
                      : '确认出资'}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <p className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            保障流程
          </p>
          <ol className="flex flex-col gap-0.5">
            {steps.map((step) => {
              const isCurrent = step.status === 'running'
              return (
                <li
                  key={step.id}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-xl px-2.5 py-2',
                    isCurrent &&
                      'bg-[color-mix(in_srgb,var(--units-orange)_10%,transparent)]'
                  )}
                >
                  {isCurrent ? (
                    <span
                      className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-[var(--units-orange)]"
                      aria-hidden
                    />
                  ) : null}
                  <StepIcon status={step.status} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {POLICY_STEP_LABELS[step.name] ?? step.name}
                  </span>
                </li>
              )
            })}
            {steps.length === 0 ? (
              <li className="px-1 text-[13px] text-muted-foreground">
                任务启动后将显示流程步骤。
              </li>
            ) : null}
          </ol>
        </section>
      </div>

      {blocking ? (
        <div className="border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] px-4 py-3">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            当前阻塞
          </p>
          <p className="mt-1 text-[13px] font-medium">{blocking}</p>
        </div>
      ) : null}
    </aside>
  )
}
