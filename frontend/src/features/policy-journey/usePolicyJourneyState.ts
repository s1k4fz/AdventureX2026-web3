import { useMemo } from 'react'

import { useAgentTaskLive } from '@/features/agent/agentApi'
import {
  mapPolicyToView,
  usePolicyComposeStream,
  usePolicyQuery,
} from '@/features/policy/policyApi'
import {
  createJourneyStateFromView,
  syncJourneyFromView,
} from './journeyReducer'
import type { PolicyJourneyState } from './types'

export function usePolicyJourneyState(
  taskId: string | undefined,
  policyIdOverride?: string | null
): {
  journey: PolicyJourneyState
  isLoading: boolean
  isError: boolean
  streamError: Error | null
  taskLive: ReturnType<typeof useAgentTaskLive>
} {
  const taskLive = useAgentTaskLive(taskId)
  const view = taskLive.view

  const policyId =
    policyIdOverride ??
    (view?.task.primaryRefType === 'policy'
      ? (view.task.primaryRefId ?? null)
      : null)

  const policyQuery = usePolicyQuery(policyId ?? undefined, {
    pollSettled: true,
  })
  const policyView = policyQuery.data
    ? mapPolicyToView(policyQuery.data)
    : null

  const composeEnabled =
    policyView?.stage === 'searching' ||
    view?.task.status === 'running'

  const compose = usePolicyComposeStream(policyId ?? undefined, {
    enabled: Boolean(composeEnabled),
  })

  const journey = useMemo(() => {
    const base = createJourneyStateFromView(view, {
      search: compose.search,
      reasoningText: compose.reasoningText,
      portfolios: policyView?.portfolios ?? [],
      policyId,
      policyStage: policyView?.stage,
    })
    return syncJourneyFromView(base, view, {
      search: compose.search,
      reasoningText: compose.reasoningText,
      portfolios: policyView?.portfolios ?? [],
      policyId,
      policyStage: policyView?.stage,
    })
  }, [
    view,
    compose.search,
    compose.reasoningText,
    policyView?.portfolios,
    policyView?.stage,
    policyId,
  ])

  return {
    journey,
    isLoading: taskLive.isLoading || policyQuery.isPending,
    isError: taskLive.isError || policyQuery.isError,
    streamError: taskLive.streamError ?? compose.error,
    taskLive,
  }
}
