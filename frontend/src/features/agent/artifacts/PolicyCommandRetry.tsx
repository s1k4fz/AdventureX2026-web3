import { isAxiosError } from 'axios'
import { useState } from 'react'

import { useAgentCommandMutation } from '../agentApi'

export function PolicyCommandRetry({ taskId }: { taskId: string }) {
  const command = useAgentCommandMutation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const retry = () => {
    setErrorMessage(null)
    command.mutate(
      {
        taskId,
        type: 'retry',
        clientRequestId: crypto.randomUUID(),
      },
      {
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 409) {
            setErrorMessage('任务状态已变化，请等待同步后再试。')
            return
          }
          if (isAxiosError(error) && error.response?.status === 401) {
            setErrorMessage('登录状态已失效，请重新登录后再试。')
            return
          }
          setErrorMessage('重试请求未成功发送，请稍后重试。')
        },
      }
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className="units-cta h-9 rounded-full px-4 text-sm font-semibold"
        disabled={command.isPending}
        onClick={retry}
      >
        {command.isPending ? '正在提交重试…' : '从当前步骤重试'}
      </button>
      {errorMessage ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}
