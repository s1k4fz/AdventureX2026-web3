import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { POLICY_STATUS_COLORS, POLICY_STATUS_LABELS } from './policyStatus'

export function PolicyStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-md text-[11px] font-semibold',
        POLICY_STATUS_COLORS[status] ?? 'bg-secondary text-secondary-foreground',
        className
      )}
    >
      {POLICY_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
