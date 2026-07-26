import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ListX } from 'lucide-react'
import { ProgressStatusIcon } from '@/components/ProgressStatusIcon'
import { SidebarSection } from '@/components/SidebarSection'
import { useAgentTasksQuery } from '../agentApi'
import type { AgentTaskListItem } from '../types'
import {
  SIDEBAR_GROUP_ORDER,
  groupLabel,
  type AgentTaskSidebarGroup,
} from '../taskSidebarMeta'
import { AgentTaskSidebarItem } from './AgentTaskSidebarItem'
import { CloseAgentTasksDialog } from './CloseAgentTasksDialog'

/** Groups where long lists collapse behind a "show all" toggle. */
const COLLAPSIBLE_GROUPS: AgentTaskSidebarGroup[] = ['进行中', '已完成']
const COLLAPSED_LIMIT = 5

function TaskGroupList({
  section,
  tasks,
}: {
  section: AgentTaskSidebarGroup
  tasks: AgentTaskListItem[]
}) {
  const [showAll, setShowAll] = useState(false)
  const collapsible =
    COLLAPSIBLE_GROUPS.includes(section) && tasks.length > COLLAPSED_LIMIT
  const visible = collapsible && !showAll ? tasks.slice(0, COLLAPSED_LIMIT) : tasks

  return (
    <>
      {visible.map((item) => (
        <AgentTaskSidebarItem key={item.id} task={item} />
      ))}
      {collapsible ? (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="flex h-8 w-full items-center gap-1.5 rounded-sm px-3 text-xs text-muted-foreground transition-colors hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800/70"
        >
          {showAll ? (
            <>
              <ChevronUp className="size-3.5" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" />
              显示全部 {tasks.length} 条
            </>
          )}
        </button>
      ) : null}
    </>
  )
}

export function AgentTaskSidebar() {
  const tasksQuery = useAgentTasksQuery()
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)

  const grouped = useMemo(() => {
    const buckets: Record<AgentTaskSidebarGroup, AgentTaskListItem[]> = {
      等待你: [],
      进行中: [],
      需关注: [],
      已完成: [],
    }
    for (const task of tasksQuery.data ?? []) {
      buckets[groupLabel(task.status)].push(task)
    }
    for (const key of SIDEBAR_GROUP_ORDER) {
      buckets[key].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    }
    return buckets
  }, [tasksQuery.data])

  const totalVisible = SIDEBAR_GROUP_ORDER.reduce(
    (sum, key) => sum + grouped[key].length,
    0
  )

  const closableCount = grouped['等待你'].length + grouped['需关注'].length

  return (
    <div className="mt-2 flex flex-col gap-1">
      {tasksQuery.isPending ? (
        <SidebarSection title="任务" forceClosed showLine={false}>
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <ProgressStatusIcon status="in-progress" />
            加载任务…
          </div>
        </SidebarSection>
      ) : tasksQuery.isError ? (
        <SidebarSection title="任务" showLine={false}>
          <p className="px-3 py-1.5 text-xs text-muted-foreground">加载失败</p>
        </SidebarSection>
      ) : totalVisible === 0 ? (
        <SidebarSection title="任务" showLine={false}>
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            还没有任务，从上方发起投保
          </p>
        </SidebarSection>
      ) : (
        <>
          {closableCount > 0 ? (
            <div className="flex justify-end px-2">
              <button
                type="button"
                onClick={() => setCloseDialogOpen(true)}
                title="取消并归档所有「等待你」与失败任务"
                className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800/70"
              >
                <ListX className="size-3.5" />
                一键关闭 ({closableCount})
              </button>
            </div>
          ) : null}
          {SIDEBAR_GROUP_ORDER.map((section) =>
            grouped[section].length > 0 ? (
              <SidebarSection
                key={section}
                title={section}
                count={grouped[section].length}
                showLine={false}
                defaultOpen={section !== '已完成'}
              >
                <TaskGroupList section={section} tasks={grouped[section]} />
              </SidebarSection>
            ) : null
          )}
          <CloseAgentTasksDialog
            open={closeDialogOpen}
            onOpenChange={setCloseDialogOpen}
            waitingTasks={grouped['等待你']}
            failedTasks={grouped['需关注']}
          />
        </>
      )}
    </div>
  )
}
