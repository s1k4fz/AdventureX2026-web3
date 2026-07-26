import { isAxiosError } from 'axios'
import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { PreferenceChipGroups } from '@/features/policy-create/PolicyCreateForm'
import {
  EMPTY_PREFERENCES,
  buildGoalText,
  type PolicyCreatePreferences,
} from '@/features/policy-create/goalText'
import { cn } from '@/lib/utils'

import { useAgentCommandMutation } from '../agentApi'
import { canSendFreeText, isInputLocked } from '../taskCapabilities'
import type { AgentTaskDetail, AgentTaskInput } from '../types'
import { SubagentBadge } from './SubagentBadge'

function lockedStatusMessage(status: AgentTaskDetail['status']): string {
  if (status === 'failed') {
    return '任务失败，不能再调整需求。可在监控页重试编排。'
  }
  if (status === 'cancelled') {
    return '任务已取消，不能再调整需求或重建阶段。'
  }
  if (status === 'monitoring') {
    return '保障已生效，任务进入监控阶段，不能再调整需求。'
  }
  return '任务已结束，不能再调整需求。'
}

function inputStatusMessage(input: AgentTaskInput): string | null {
  switch (input.status) {
    case 'queued':
      return `第 ${input.revision} 条调整已记录，等待任务接管。`
    case 'applying':
      return `正在处理第 ${input.revision} 条调整，并从安全检查点重建后续阶段。`
    case 'applied':
      return `第 ${input.revision} 条调整已应用到当前任务。`
    case 'superseded':
      return null
  }
}

function useLatestInput(task: AgentTaskDetail): AgentTaskInput | null {
  return useMemo(
    () =>
      task.inputs.reduce<AgentTaskInput | null>(
        (latest, input) =>
          !latest || input.revision > latest.revision ? input : latest,
        null
      ),
    [task.inputs]
  )
}

/**
 * 工作台顶部状态横幅：任务锁定态提示 + 最近一次需求调整的 revision 进度。
 * 替代原对话指令栏内嵌的回执文案。
 */
export function TaskStatusBanner({ task }: { task: AgentTaskDetail }) {
  const latestInput = useLatestInput(task)

  if (isInputLocked(task.status)) {
    return (
      <p
        role="status"
        className="shrink-0 border-b border-[var(--units-stroke-color)] px-4 py-2 text-[12.5px] text-muted-foreground"
      >
        {lockedStatusMessage(task.status)}
      </p>
    )
  }

  const inputStatus = latestInput ? inputStatusMessage(latestInput) : null
  if (!inputStatus) return null

  const busy =
    latestInput?.status === 'queued' || latestInput?.status === 'applying'

  return (
    <p
      role="status"
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-[var(--units-stroke-color)] px-4 py-2 text-[12.5px]',
        busy ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {busy ? <Spinner className="size-3 text-[var(--units-orange)]" /> : null}
      {inputStatus}
    </p>
  )
}

/**
 * 「调整需求」面板：浮动按钮 + 右侧 Sheet 表单。
 * 底层仍走 free_text command API（revision/CAS 机制不变），仅交互形态
 * 从常驻对话栏改为按需打开的工作台面板。
 */
export function TaskAdjustPanel({
  task,
  openRequest,
  hideTrigger = false,
}: {
  task: AgentTaskDetail
  /** 外部请求打开面板并预填文案（如回看态的「基于此步提出调整」）。 */
  openRequest?: { text: string; nonce: number } | null
  /**
   * 隐藏自带的浮动触发按钮，由外部（StageGuideBar 右侧）提供入口，
   * 避免与 StageShell 底部固定操作栏重叠。
   */
  hideTrigger?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [preferences, setPreferences] =
    useState<PolicyCreatePreferences>(EMPTY_PREFERENCES)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const command = useAgentCommandMutation()
  const isMobile = useIsMobile()
  // 外部预填（渲染期派生）：同一 nonce 只处理一次，不覆盖用户草稿。
  const [handledNonce, setHandledNonce] = useState<number | null>(null)
  if (openRequest && openRequest.nonce !== handledNonce) {
    setHandledNonce(openRequest.nonce)
    setDraft((current) => (current.trim() ? current : openRequest.text))
    setOpen(true)
  }

  if (!canSendFreeText(task.status)) return null

  const errorFor = (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      return '任务状态刚刚变化，未应用这条调整。请等待同步后再试。'
    }
    if (isAxiosError(error) && error.response?.status === 401) {
      return '登录状态已失效，请重新登录后再提交。'
    }
    if (isAxiosError(error) && error.response?.status === 404) {
      return '此任务已不存在或无权访问，无法提交调整。'
    }
    return '调整提交失败，内容已保留，可以重试。'
  }

  const canSubmit = draft.trim().length > 0 && !command.isPending

  const submit = () => {
    if (!canSubmit) return
    setErrorMessage(null)
    command.mutate(
      {
        taskId: task.id,
        type: 'free_text',
        text: buildGoalText(draft, preferences),
        clientRequestId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          // 面板关闭后由顶部状态横幅接管 revision 进度反馈。
          setDraft('')
          setPreferences(EMPTY_PREFERENCES)
          setOpen(false)
        },
        onError: (error) => {
          setErrorMessage(errorFor(error))
        },
      }
    )
  }

  return (
    <>
      {hideTrigger ? null : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="absolute bottom-4 right-4 z-10 h-9 rounded-full border border-[var(--units-stroke-color)] bg-background px-3.5 text-[13px] font-medium shadow-none hover:border-[var(--units-stroke-strong)]"
        >
          <SlidersHorizontal className="size-3.5" />
          调整需求
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile ? 'max-h-[85dvh]' : 'sm:max-w-md'}
        >
          <SheetHeader className="pb-0">
            <SheetTitle>调整需求</SheetTitle>
            <SheetDescription>
              补充约束或偏好，任务会在安全检查点按新需求续跑，已完成阶段不受影响。
            </SheetDescription>
            {/* 上下文保持：明确这条输入由谁处理。 */}
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-wash-strong)] px-3 py-2">
              <SubagentBadge mainAgent size="sm" showRole={false} />
              <span className="text-[11.5px] text-muted-foreground">
                将在下一个安全检查点接手这条调整
              </span>
            </div>
          </SheetHeader>

          <div className="scrollbar-fade flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="task-adjust-text"
                className="text-[12px] font-semibold text-muted-foreground"
              >
                需求补充
              </label>
              <Textarea
                id="task-adjust-text"
                value={draft}
                disabled={command.isPending}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="补充约束、调整偏好，或直接描述下一步…"
                className="min-h-[96px] resize-none rounded-xl border-[var(--units-stroke-color)] bg-background px-3.5 py-3 text-[14px] leading-6"
              />
            </div>

            <PreferenceChipGroups
              preferences={preferences}
              onChange={setPreferences}
              disabled={command.isPending}
            />

            {errorMessage ? (
              <p role="alert" className="text-[12.5px] font-medium text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--units-stroke-color)]">
            <Button
              type="button"
              variant="ghost"
              disabled={command.isPending}
              onClick={() => setOpen(false)}
              className="h-[36px] rounded-full px-4 text-[13px] font-normal text-muted-foreground"
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="h-[36px] rounded-full bg-zinc-950 px-4 text-[13px] font-normal text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {command.isPending ? <Spinner className="size-3.5" /> : null}
              提交调整
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
