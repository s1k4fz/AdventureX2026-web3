import { useCallback, useEffect, useRef, useState } from 'react'

import { useAgentCommandMutation } from '@/features/agent/agentApi'

const OVERRIDE_TIMEOUT_MS = 30_000

export interface UseOverrideFlowOptions {
  taskId?: string
  isOverriding: boolean
}

export function useOverrideFlow({ taskId, isOverriding }: UseOverrideFlowOptions) {
  const command = useAgentCommandMutation()
  const [timedOut, setTimedOut] = useState(false)
  const [lastText, setLastText] = useState<string | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearTimeoutState = useCallback(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setTimedOut(false)
  }, [])

  const startTimeout = useCallback(() => {
    clearTimeoutState()
    timeoutRef.current = window.setTimeout(() => {
      setTimedOut(true)
      timeoutRef.current = null
    }, OVERRIDE_TIMEOUT_MS)
  }, [clearTimeoutState])

  useEffect(() => {
    if (isOverriding) {
      startTimeout()
      return
    }
    clearTimeoutState()
  }, [isOverriding, startTimeout, clearTimeoutState])

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const submitOverride = useCallback(
    (text: string) => {
      if (!taskId) return
      const trimmed = text.trim()
      if (!trimmed) return

      setLastText(trimmed)
      setTimedOut(false)
      command.mutate({
        taskId,
        type: 'revise_goal',
        text: trimmed,
        clientRequestId: crypto.randomUUID(),
      })
    },
    [command, taskId]
  )

  const retry = useCallback(() => {
    if (!lastText) return
    setTimedOut(false)
    submitOverride(lastText)
  }, [lastText, submitOverride])

  const isPending = command.isPending || isOverriding

  return {
    submitOverride,
    isPending,
    timedOut,
    retry,
    clearTimeoutState,
  }
}
