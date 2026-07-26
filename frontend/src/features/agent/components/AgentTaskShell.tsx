import type { AgentActivityItem, AgentTaskDetail } from '../types'
import { AgentCanvas } from './AgentCanvas'
import { AgentCommandDock } from './AgentCommandDock'

export function AgentTaskShell({
  task,
  activities,
  activeViewId,
  onSelectView,
}: {
  task: AgentTaskDetail
  activities: AgentActivityItem[]
  activeViewId?: string | null
  onSelectView?: (id: string) => void
}) {
  return (
    <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
      <AgentCanvas
        task={task}
        activeViewId={activeViewId}
        onSelectView={onSelectView}
        activities={activities}
        className="min-h-0 flex-1"
        compactChrome
      />
      <AgentCommandDock task={task} />
    </div>
  )
}
