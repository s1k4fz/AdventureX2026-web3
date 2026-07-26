import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAgentTaskLive } from '@/features/agent/agentApi'
import { AgentTaskShell } from '@/features/agent/components/AgentTaskShell'
import { WorkbenchLoadingState } from '@/features/agent/components/WorkbenchLoadingState'

export function AgentTaskPage() {
  const { id } = useParams<{ id: string }>()
  const {
    view,
    isLoading,
    isError,
    streamError,
    connectionState,
    setActiveViewId,
  } = useAgentTaskLive(id)

  if (isLoading) {
    return (
      <WorkbenchLoadingState
        message="正在加载工作台…"
        hint="同步任务进度与产物画布"
      />
    )
  }

  if (isError || !view) {
    return (
      <div className="units-app-panel flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {streamError
            ? `实时连接已停止：${streamError.message}`
            : '任务不存在或加载失败'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="rounded-lg border border-[var(--units-stroke-color)]"
          onClick={() => window.location.assign('/home')}
        >
          返回看板
        </Button>
      </div>
    )
  }

  return (
    <AgentTaskShell
      task={view.task}
      activities={view.activities}
      activeViewId={view.activeViewId}
      onSelectView={(viewId) => setActiveViewId(viewId)}
      connectionState={connectionState}
    />
  )
}
