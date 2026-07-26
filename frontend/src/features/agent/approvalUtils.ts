import { useMemo } from 'react'

import type { AgentApproval, AgentTaskDetail } from './types'

export function usePendingApproval(
  task: AgentTaskDetail,
  kind: AgentApproval['kind']
) {
  return useMemo(
    () =>
      task.approvals.find(
        (item) => item.kind === kind && item.status === 'pending'
      ) ?? null,
    [task.approvals, kind]
  )
}
