import { cn } from '@/lib/utils'

import {
  POLICY_FLOW_STATUS_STYLES,
  type PolicyFlowStatus,
} from '../policyFlowStatus'

export function PolicyFlowStatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: PolicyFlowStatus
  className?: string
  showDot?: boolean
}) {
  const styles = POLICY_FLOW_STATUS_STYLES[status.kind]

  return (
    <span
      data-slot="policy-flow-status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold tracking-tight',
        styles.badge,
        className
      )}
    >
      {showDot ? (
        <span
          className={cn('size-1.5 shrink-0 rounded-full', styles.dot)}
          aria-hidden
        />
      ) : null}
      {status.label}
    </span>
  )
}
