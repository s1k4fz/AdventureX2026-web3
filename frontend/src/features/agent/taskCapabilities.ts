import type { AgentTaskStatus } from './types'

/**
 * Terminal / post-funding statuses where the command dock must not accept
 * free-text or revise_goal. Backend still allows monitoring_only inputs for
 * future monitoring-rule tooling; product UX locks the dock once funding is done.
 */
export function isInputLocked(status: AgentTaskStatus): boolean {
  return (
    status === 'succeeded' ||
    status === 'cancelled' ||
    status === 'failed' ||
    status === 'monitoring'
  )
}

export function canSendFreeText(status: AgentTaskStatus): boolean {
  return (
    status === 'draft' ||
    status === 'running' ||
    status === 'waiting_user'
  )
}

/** Goal revision rebuilds pipeline stages — not available during monitoring. */
export function canReviseGoal(status: AgentTaskStatus): boolean {
  return (
    status === 'draft' || status === 'running' || status === 'waiting_user'
  )
}

/** Active HITL only — historical tabs stay browsable but non-mutable. */
export function canSubmitApprovals(status: AgentTaskStatus): boolean {
  return status === 'waiting_user'
}

export function canRetry(status: AgentTaskStatus): boolean {
  return status === 'failed'
}

export function canCancel(status: AgentTaskStatus): boolean {
  return (
    status === 'draft' ||
    status === 'running' ||
    status === 'waiting_user' ||
    status === 'monitoring' ||
    status === 'failed'
  )
}

/** Funding CTA that starts on-chain open — not for monitoring/terminal. */
export function canProceedToFunding(status: AgentTaskStatus): boolean {
  return status === 'waiting_user' || status === 'running'
}
