import { NavLink } from 'react-router-dom'
import { ProgressStatusIcon } from '@/components/ProgressStatusIcon'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { cn } from '@/lib/utils'
import type { AgentTaskListItem, AgentTaskStatus } from '../types'
import { statusHint } from '../taskSidebarMeta'
import { AgentTaskSidebarMenu } from './AgentTaskSidebarMenu'

function progressStatus(status: AgentTaskStatus) {
  if (status === 'succeeded') return 'completed' as const
  if (status === 'failed' || status === 'cancelled') return 'failed' as const
  if (status === 'waiting_user') return 'waiting' as const
  if (status === 'draft') return 'not-started' as const
  return 'in-progress' as const
}

export function AgentTaskSidebarItem({
  task,
}: {
  task: AgentTaskListItem
}) {
  const waiting = task.status === 'waiting_user'
  const relativeTime = formatRelativeTime(task.updatedAt)
  const hint = statusHint(task.status)

  return (
    <div className="group/task-item relative">
      <NavLink
        to={`/tasks/${task.id}`}
        title={`${task.goalText || task.title}${hint ? ` · ${hint}` : ''}`}
        className={({ isActive }) =>
          cn(
            'flex h-9 w-full items-center gap-2 rounded-sm px-3 pe-2 text-sm transition-colors',
            isActive
              ? 'bg-zinc-200/80 text-black dark:bg-zinc-800/80 dark:text-zinc-50'
              : 'text-black hover:bg-zinc-200/70 dark:text-zinc-50 dark:hover:bg-zinc-800/70'
          )
        }
      >
        <ProgressStatusIcon
          status={progressStatus(task.status)}
          className="size-3.5 shrink-0"
        />
        <span
          className={cn('min-w-0 flex-1 truncate', waiting && 'font-medium')}
        >
          {task.title}
        </span>
        {relativeTime ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70 transition-opacity group-hover/task-item:opacity-0 group-focus-within/task-item:opacity-0">
            {relativeTime}
          </span>
        ) : null}
      </NavLink>
      <div className="pointer-events-none absolute inset-y-0 end-1 flex items-center opacity-0 transition-opacity group-hover/task-item:pointer-events-auto group-hover/task-item:opacity-100 group-focus-within/task-item:pointer-events-auto group-focus-within/task-item:opacity-100">
        <AgentTaskSidebarMenu task={task} />
      </div>
    </div>
  )
}
