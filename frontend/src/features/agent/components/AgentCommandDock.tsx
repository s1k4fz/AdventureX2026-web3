import { isAxiosError } from 'axios'
import { useEffect, useMemo, useState } from 'react'

import { AgentInput, type AgentInputPayload } from '@/components/AgentInput'
import { useAgentCommandMutation } from '../agentApi'
import { canSendFreeText, isInputLocked } from '../taskCapabilities'
import type { AgentTaskDetail, AgentTaskInput } from '../types'

function lockedStatusMessage(status: AgentTaskDetail['status']): string {
  if (status === 'failed') {
    return '任务失败，不能再提交指令。可在监控页重试编排。'
  }
  if (status === 'cancelled') {
    return '任务已取消，不能再提交或重建阶段。'
  }
  if (status === 'monitoring') {
    return '保障已生效，任务进入监控阶段，不能再提交指令。'
  }
  return '任务已结束，不能再提交指令。'
}

export function AgentCommandDock({
  task,
  collapsed = false,
  onToggleCollapsed,
}: {
  task: AgentTaskDetail
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const command = useAgentCommandMutation()
  const locked = isInputLocked(task.status)
  const showInput = canSendFreeText(task.status)
  const latestInput = useMemo(
    () =>
      task.inputs.reduce<AgentTaskInput | null>(
        (latest, input) =>
          !latest || input.revision > latest.revision ? input : latest,
        null
      ),
    [task.inputs]
  )

  useEffect(() => {
    if (!acceptedMessage) return undefined
    const timeout = window.setTimeout(() => setAcceptedMessage(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [acceptedMessage])

  const errorFor = (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      return '任务状态刚刚变化，未应用这条指令。请等待同步后再试。'
    }
    if (isAxiosError(error) && error.response?.status === 401) {
      return '登录状态已失效，请重新登录后再提交。'
    }
    if (isAxiosError(error) && error.response?.status === 404) {
      return '此任务已不存在或无权访问，无法提交指令。'
    }
    return '指令提交失败，内容已保留，可以重试。'
  }

  const send = (payload: AgentInputPayload) => {
    if (!canSendFreeText(task.status)) return
    setErrorMessage(null)
    setAcceptedMessage(null)
    command.mutate(
      {
        taskId: task.id,
        type: 'free_text',
        text: payload.content,
        clientRequestId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          setDraft('')
          setAcceptedMessage('已接收，当前阶段会在安全检查点按新约束续跑。')
        },
        onError: (error) => {
          setDraft(payload.content)
          setErrorMessage(errorFor(error))
        },
      }
    )
  }

  const inputStatus = latestInput ? inputStatusMessage(latestInput) : null

  if (collapsed) {
    if (locked || !showInput) {
      return (
        <div className="units-workspace-input-dock shrink-0 border-t border-[color-mix(in_srgb,var(--units-black)_10%,transparent)] px-3 py-2">
          <p
            className="flex h-9 items-center px-2 text-[13px] text-muted-foreground"
            role="status"
          >
            {lockedStatusMessage(task.status)}
          </p>
        </div>
      )
    }
    return (
      <div className="units-workspace-input-dock shrink-0 border-t border-[color-mix(in_srgb,var(--units-black)_10%,transparent)] px-3 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex h-9 w-full items-center justify-between rounded-xl px-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] hover:text-foreground"
        >
          <span>指令栏已收起 · 需要时可展开补充要求</span>
          <span className="text-[12px] text-[var(--units-orange)]">展开</span>
        </button>
      </div>
    )
  }

  return (
    <div className="units-workspace-input-dock shrink-0 p-2.5 sm:p-3">
      {onToggleCollapsed ? (
        <div className="mb-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            收起指令栏
          </button>
        </div>
      ) : null}
      {locked || !showInput ? (
        <p className="px-1 py-2 text-xs text-muted-foreground" role="status">
          {lockedStatusMessage(task.status)}
        </p>
      ) : (
        <>
          {acceptedMessage ? (
            <p
              className="mb-2 px-1 text-[12px] font-medium text-[var(--units-green)]"
              role="status"
            >
              {acceptedMessage}
            </p>
          ) : null}
          {inputStatus ? (
            <p
              className="mb-2 px-1 text-[12px] text-muted-foreground"
              role="status"
            >
              {inputStatus}
            </p>
          ) : null}
          {errorMessage ? (
            <p
              className="mb-2 px-1 text-[12px] font-medium text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
          <AgentInput
            className="mx-auto w-full max-w-2xl"
            value={draft}
            onValueChange={setDraft}
            onSend={send}
            isBusy={command.isPending}
            variant="home"
            modeLabel="任务指令"
            placeholder="补充约束、调整偏好，或直接描述下一步…"
          />
        </>
      )}
    </div>
  )
}

function inputStatusMessage(input: AgentTaskInput) {
  switch (input.status) {
    case 'queued':
      return `第 ${input.revision} 条指令已记录，等待任务接管。`
    case 'applying':
      return `正在处理第 ${input.revision} 条指令，并从安全检查点重建后续阶段。`
    case 'applied':
      return `第 ${input.revision} 条指令已应用到当前任务。`
    case 'superseded':
      return `第 ${input.revision} 条指令已由更新的输入替代。`
  }
}
