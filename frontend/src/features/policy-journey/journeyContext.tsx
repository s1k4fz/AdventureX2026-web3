import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { JourneyStage, PolicyJourneyState } from './types'
import { usePolicyJourneyState } from './usePolicyJourneyState'

export interface PolicyJourneyContextValue {
  journey: PolicyJourneyState
  isLoading: boolean
  isError: boolean
  streamError: Error | null
  /**
   * Read-only review target selected from the flow rail. `null` while the
   * canvas follows the live stage. Pure view state — never enters the event
   * reducer path, so SSE idempotency is unaffected.
   */
  focusedStage: JourneyStage | null
  setFocusedStage: (stage: JourneyStage | null) => void
}

const PolicyJourneyContext = createContext<PolicyJourneyContextValue | null>(
  null
)

/**
 * Single journey-state source for the whole workbench: the flow rail and the
 * canvas artifact share one `usePolicyJourneyState` subscription instead of
 * each opening their own SSE-backed instance.
 */
export function PolicyJourneyProvider({
  taskId,
  policyId,
  children,
}: {
  taskId: string | undefined
  policyId?: string | null
  children: ReactNode
}) {
  const { journey, isLoading, isError, streamError } = usePolicyJourneyState(
    taskId,
    policyId
  )
  const [focusedStage, setFocusedStage] = useState<JourneyStage | null>(null)

  // Selecting the live stage (or the flow catching up to the reviewed stage)
  // exits review mode automatically.
  const effectiveFocused =
    focusedStage && focusedStage !== journey.currentStage ? focusedStage : null

  const value = useMemo<PolicyJourneyContextValue>(
    () => ({
      journey,
      isLoading,
      isError,
      streamError,
      focusedStage: effectiveFocused,
      setFocusedStage,
    }),
    [journey, isLoading, isError, streamError, effectiveFocused]
  )

  return (
    <PolicyJourneyContext.Provider value={value}>
      {children}
    </PolicyJourneyContext.Provider>
  )
}

export function usePolicyJourneyContext(): PolicyJourneyContextValue | null {
  return useContext(PolicyJourneyContext)
}
