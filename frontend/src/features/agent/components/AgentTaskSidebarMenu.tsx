import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive,
  Ban,
  Ellipsis,
  ExternalLink,
  Pencil,
} from 'lucide-react'
import {
  ActionMenu,
  ActionMenuItem,
  ActionMenuSeparator,
} from '@/components/ActionMenu'
import { Button } from '@/components/ui/button'
import {
  useAgentCommandMutation,
  useUpdateAgentTaskMutation,
} from '../agentApi'
import type { AgentTaskListItem } from '../types'
import { canCancel } from '../taskCapabilities'
import { RenameAgentTaskDialog } from './RenameAgentTaskDialog'

export function AgentTaskSidebarMenu({ task }: { task: AgentTaskListItem }) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const updateMutation = useUpdateAgentTaskMutation()
  const commandMutation = useAgentCommandMutation()

  const showCancel = canCancel(task.status)

  const policyHref =
    task.primaryRefType === 'policy' && task.primaryRefId
      ? `/policy/${task.primaryRefId}`
      : null

  return (
    <>
      <ActionMenu
        onContentClick={(event) => event.stopPropagation()}
        trigger={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="任务操作"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <Ellipsis className="size-4" />
          </Button>
        }
      >
        <ActionMenuItem
          label="重命名"
          icon={Pencil}
          onSelect={() => setRenameOpen(true)}
        />
        {policyHref ? (
          <ActionMenuItem
            label="打开保单"
            icon={ExternalLink}
            onSelect={() => navigate(policyHref)}
          />
        ) : null}
        {showCancel ? (
          <ActionMenuItem
            label="取消任务"
            icon={Ban}
            disabled={commandMutation.isPending}
            onSelect={() =>
              commandMutation.mutate({ taskId: task.id, type: 'cancel' })
            }
          />
        ) : null}
        <ActionMenuSeparator />
        <ActionMenuItem
          label="归档"
          icon={Archive}
          disabled={updateMutation.isPending}
          onSelect={() =>
            updateMutation.mutate(
              { taskId: task.id, archived: true },
              {
                onSuccess: () => {
                  if (window.location.pathname === `/tasks/${task.id}`) {
                    navigate('/home')
                  }
                },
              }
            )
          }
        />
      </ActionMenu>

      <RenameAgentTaskDialog
        key={`${task.id}-${task.title}`}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        taskId={task.id}
        initialTitle={task.title}
      />
    </>
  )
}
