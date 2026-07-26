import { AnimatePresence, motion } from 'motion/react'

import { useUnitsMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  canvasTabs,
  resolveArtifactView,
} from '../artifactRegistry'
import type { AgentActivityItem, AgentTaskDetail } from '../types'

export function AgentCanvas({
  task,
  activeViewId,
  onSelectView,
  activities,
  compactChrome = false,
  className,
}: {
  task: AgentTaskDetail
  activeViewId?: string | null
  onSelectView?: (id: string) => void
  activities?: AgentActivityItem[]
  compactChrome?: boolean
  className?: string
}) {
  const { tabs, active } = canvasTabs(task, activeViewId)
  const view = resolveArtifactView(task, activeViewId ?? active)
  const View = view.component
  const policyId =
    task.primaryRefType === 'policy' ? (task.primaryRefId ?? null) : null
  const artifact = task.artifacts[0] ?? {
    id: 'virtual',
    refType: task.primaryRefType ?? 'policy',
    refId: task.primaryRefId ?? task.id,
    role: 'primary',
    label: task.title,
    meta: null,
    createdAt: task.createdAt,
  }
  const showTabs = tabs.length > 1
  const { layout, reduce, y } = useUnitsMotion()
  const viewKey = activeViewId ?? active

  return (
    <section
      aria-label="产物画布"
      className={cn('units-workspace-pane flex h-full min-h-0 flex-col', className)}
    >
      {compactChrome && !showTabs ? null : (
        <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] px-4">
          <div className="min-w-0">
            {!compactChrome ? (
              <>
                <p className="units-text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  产物画布
                </p>
                <h2 className="units-text-body-sm truncate font-semibold">
                  {view.label}
                </h2>
              </>
            ) : (
              <h2 className="units-text-body-sm truncate font-semibold">
                {view.label}
              </h2>
            )}
          </div>
          {showTabs ? (
            <div className="scrollbar-hidden flex max-w-[60%] gap-1 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  disabled={!tab.unlocked}
                  onClick={() => onSelectView?.(tab.id)}
                  className={cn(
                    'units-text-caption shrink-0 rounded-[var(--units-radius-sm)] px-2 py-1 font-semibold transition-colors',
                    tab.id === active
                      ? 'bg-[var(--units-blue)] text-[var(--units-on-accent)]'
                      : tab.unlocked
                        ? 'text-foreground hover:bg-[color-mix(in_srgb,var(--units-black)_6%,transparent)]'
                        : 'cursor-not-allowed text-muted-foreground/50'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </header>
      )}

      <div
        data-agent-canvas-content
        className="agent-canvas-content scrollbar-fade flex min-h-0 flex-1 flex-col overflow-hidden [overflow-wrap:anywhere]"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={viewKey}
            className="flex min-h-0 flex-1 flex-col"
            initial={reduce ? false : { opacity: 0, y }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={layout}
          >
            <View
              task={task}
              artifact={artifact}
              policyId={policyId}
              activities={activities}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
