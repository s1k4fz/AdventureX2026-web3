import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import {
  getPolicyOracleStatus,
  type PolicyOracleStatus,
} from './policyApi'

export {
  getOracleStatusErrorKind,
  type OracleStatusErrorKind,
} from './oracleStatusUtils'

const ORACLE_POLL_MS = 10_000

export function oracleStatusQueryKey(policyId: string) {
  return ['policy-planner', 'oracle-status', policyId] as const
}

/**
 * Poll the oracle settlement status for a policy.
 * Enabled when awaiting settle or viewing settled history.
 * Self-stopping: stops polling once all legs are resolved, legacy mode, or poll=false.
 */
export function useOracleStatusQuery(
  policyId: string | undefined,
  options?: {
    enabled?: boolean
    /** When false (e.g. settled history), fetch once and do not poll. */
    poll?: boolean
    pollInterval?: number
  }
) {
  const pollInterval = options?.pollInterval ?? ORACLE_POLL_MS
  const shouldPoll = options?.poll ?? true

  return useQuery<PolicyOracleStatus>({
    queryKey: oracleStatusQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicyOracleStatus(policyId as string),
    enabled: Boolean(policyId) && (options?.enabled ?? true),
    refetchInterval: (query) => {
      if (!shouldPoll) return false
      const data = query.state.data
      if (!data) return pollInterval
      if (data.mode === 'legacy') return false
      if (data.allResolved) return false
      return pollInterval
    },
    retry: (failureCount, error) => {
      if (isAxiosError(error) && error.response?.status === 404) {
        return false
      }
      // 503 chain blips: retry a couple times
      if (isAxiosError(error) && error.response?.status === 503) {
        return failureCount < 2
      }
      return failureCount < 2
    },
    staleTime: 5_000,
  })
}
