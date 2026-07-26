import { ScrollText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { SubagentBadge } from './SubagentBadge'
import {
  briefSummary,
  citationList,
  fallbackLabel,
  itemCount,
  latencyLabel,
  providerLabel,
} from '../subagentBrief'
import { latestRun } from '../eventReducer'
import type { AgentActivityItem, AgentTaskDetail } from '../types'
import { POLICY_STEP_LABELS, SUBAGENT_STATUS_LABELS } from '../types'

/** On-demand inspector for evidence, errors, and run logs — avoids a permanent third column. */
export function AgentInspector({
  task,
  activities,
}: {
  task: AgentTaskDetail
  activities: AgentActivityItem[]
}) {
  const run = latestRun(task)
  const recent = task.recentEvents.slice().reverse().slice(0, 40)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-[var(--units-stroke-color)] bg-transparent shadow-none hover:bg-[color-mix(in_srgb,var(--units-black)_5%,transparent)]"
        >
          <ScrollText className="size-3.5" />
          详情
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(100%,28rem)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>运行详情</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-5 px-1 pb-6">
          {(task.errorCode || task.errorMessage) && (
          <section className="rounded-xl bg-[color-mix(in_srgb,var(--units-red)_10%,transparent)] p-3">
              <p className="text-[10px] font-semibold tracking-[0.1em] text-[var(--units-red)] uppercase">
                Error
              </p>
              <p className="mt-1 text-sm font-medium">
                {task.errorCode ?? 'failed'}
              </p>
              {task.errorMessage ? (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {task.errorMessage}
                </p>
              ) : null}
            </section>
          )}

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Run Steps
            </p>
            <ul className="flex flex-col gap-1.5">
              {(run?.steps ?? []).map((step) => (
                <li
                  key={step.id}
                  className="rounded-lg bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-2.5 py-2 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {POLICY_STEP_LABELS[step.name] ?? step.name}
                    </span>
                    <span className="text-muted-foreground">{step.status}</span>
                  </div>
                  {step.errorMessage ? (
                    <p className="mt-1 text-[11px] text-[var(--units-red)]">
                      {step.errorMessage}
                    </p>
                  ) : null}
                </li>
              ))}
              {!run?.steps?.length ? (
                <li className="text-[12px] text-muted-foreground">暂无步骤投影</li>
              ) : null}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              调查员
            </p>
            <ul className="flex flex-col gap-1.5">
              {(task.subagents ?? []).map((row) => {
                const provider = providerLabel(row)
                const fallback = fallbackLabel(row)
                const latency = latencyLabel(row)
                const count = itemCount(row)
                const cites = citationList(row).slice(0, 3)
                return (
                <li
                  key={row.id}
                  className="rounded-lg bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-2.5 py-2 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SubagentBadge
                      kind={row.kind}
                      status={row.status}
                      size="sm"
                      showRole={false}
                    />
                    <span className="text-muted-foreground">
                      {SUBAGENT_STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
                    {briefSummary(row) || '—'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {provider ? <span>{provider}</span> : null}
                    {fallback ? <span>· 降级自 {fallback}</span> : null}
                    {count > 0 ? <span>· {count} 条</span> : null}
                    {latency ? <span>· {latency}</span> : null}
                  </div>
                  {cites.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] pt-1.5">
                      {cites.map((cite, i) => (
                        <li
                          key={`${row.id}-c-${i}`}
                          className="truncate text-[11px] text-muted-foreground"
                        >
                          {cite.title || cite.url || '引用'}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {row.errorMessage ? (
                    <p className="mt-1 text-[11px] text-[var(--units-red)]">
                      {row.errorMessage}
                    </p>
                  ) : null}
                </li>
                )
              })}
              {!task.subagents?.length ? (
                <li className="text-[12px] text-muted-foreground">
                  采集子代理尚未启动
                </li>
              ) : null}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Activity Digest
            </p>
            <ul className="flex flex-col gap-1.5">
              {activities
                .slice()
                .reverse()
                .slice(0, 30)
                .map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-[var(--units-wash-strong)] px-2.5 py-2 text-[12px]"
                  >
                    {item.summary}
                  </li>
                ))}
              {activities.length === 0 ? (
                <li className="text-[12px] text-muted-foreground">暂无活动</li>
              ) : null}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              User Inputs
            </p>
            <ul className="flex flex-col gap-1.5">
              {task.inputs
                .slice()
                .reverse()
                .map((input) => (
                  <li
                    key={input.id}
                    className="rounded-lg bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-2.5 py-2 text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {input.type === 'revise_goal' ? '改写目标' : '补充约束'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        r{input.revision} · {input.status}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {input.text}
                    </p>
                  </li>
                ))}
              {task.inputs.length === 0 ? (
                <li className="text-[12px] text-muted-foreground">
                  任意阶段提交的补充都会在这里保留。
                </li>
              ) : null}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Event Log
            </p>
            <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
              {recent.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-2 py-1.5"
                >
                  <span className="text-muted-foreground">#{event.sequence}</span>{' '}
                  {event.eventType}
                </li>
              ))}
              {recent.length === 0 ? (
                <li className="text-muted-foreground">暂无事件</li>
              ) : null}
            </ul>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Artifacts
            </p>
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {task.artifacts.map((artifact) => (
                <li
                  key={artifact.id}
                  className="rounded-lg bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-2.5 py-2"
                >
                  <p className="font-medium">{artifact.label ?? artifact.refType}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {artifact.refType}:{artifact.refId}
                  </p>
                </li>
              ))}
              {task.artifacts.length === 0 ? (
                <li className="text-muted-foreground">尚无产物引用</li>
              ) : null}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
