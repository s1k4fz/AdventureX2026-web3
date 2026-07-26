import { X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBulkCloseAgentTasksMutation } from '../agentApi'
import type { AgentTaskListItem } from '../types'

/** Confirm dialog for one-click closing all failed / waiting tasks. */
export function CloseAgentTasksDialog({
  open,
  onOpenChange,
  waitingTasks,
  failedTasks,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  waitingTasks: AgentTaskListItem[]
  failedTasks: AgentTaskListItem[]
}) {
  const navigate = useNavigate()
  const closeMutation = useBulkCloseAgentTasksMutation()
  const total = waitingTasks.length + failedTasks.length

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) closeMutation.reset()
    onOpenChange(nextOpen)
  }

  const handleConfirm = () => {
    const targets = [...waitingTasks, ...failedTasks]
    closeMutation.mutate(targets, {
      onSuccess: (result) => {
        if (result.failed === 0) onOpenChange(false)
        // Leave the detail page if the task being viewed was just closed.
        if (
          targets.some(
            (task) => window.location.pathname === `/tasks/${task.id}`
          )
        ) {
          navigate('/home')
        }
      },
    })
  }

  const partialFailed =
    closeMutation.data && closeMutation.data.failed > 0
      ? closeMutation.data.failed
      : 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-background shadow-xl outline-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
        >
          <div className="flex min-h-14 items-start gap-2 p-2 ps-4">
            <div className="mt-1 flex flex-col">
              <DialogPrimitive.Title className="text-lg font-normal text-foreground">
                一键关闭任务
              </DialogPrimitive.Title>
            </div>
            <div className="grow" />
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭"
                className="rounded-full"
              >
                <X className="size-5" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="px-4 pt-1 text-sm text-muted-foreground">
            <p>
              即将关闭 {total} 个任务：
              {waitingTasks.length > 0 && (
                <>取消并归档 {waitingTasks.length} 个「等待你」任务</>
              )}
              {waitingTasks.length > 0 && failedTasks.length > 0 && '，'}
              {failedTasks.length > 0 && (
                <>归档 {failedTasks.length} 个失败任务</>
              )}
              。
            </p>
            <p className="mt-1 text-xs">归档后任务将从侧边栏移除。</p>
            {partialFailed > 0 && (
              <p className="mt-2 text-xs text-destructive">
                有 {partialFailed} 个任务关闭失败，可重试
              </p>
            )}
            {closeMutation.isError && (
              <p className="mt-2 text-xs text-destructive">
                操作失败，请重试
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-3 pb-3 pt-4">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" className="rounded-full">
                取消
              </Button>
            </DialogPrimitive.Close>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={closeMutation.isPending || total === 0}
              onClick={handleConfirm}
              className="rounded-full"
            >
              {closeMutation.isPending ? '关闭中…' : `关闭全部 (${total})`}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
