import { CircleCheckBig, CirclePause, CircleX } from 'lucide-react'
import { BacklogStatusIcon } from '@/components/BacklogStatusIcon'
import { cn } from '@/lib/utils'

export type ProgressStatus =
  | 'not-started'
  | 'in-progress'
  | 'waiting'
  | 'completed'
  | 'failed'

function InProgressStatusIcon({
  value,
  className,
}: {
  value?: number
  className?: string
}) {
  const radius = 2
  const circumference = 2 * Math.PI * radius
  const clampedValue = Math.min(Math.max(value ?? 33, 0), 100)
  const offset = circumference * (1 - clampedValue / 100)
  const indeterminate = value === undefined
  const dynamicProgressProps = indeterminate
    ? {
        strokeDasharray: '4.17 100',
        strokeDashoffset: 0,
      }
    : {
        strokeDasharray: circumference,
        strokeDashoffset: offset,
      }

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={cn(indeterminate && 'units-progress-arc', className)}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="var(--units-green)"
        strokeWidth="2"
        strokeDasharray="3.14 0"
        strokeDashoffset="-0.7"
        opacity={0.35}
      />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="var(--units-orange)"
        strokeWidth="4"
        {...dynamicProgressProps}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

export function ProgressStatusIcon({
  status,
  value,
  className,
}: {
  status: ProgressStatus
  value?: number
  className?: string
}) {
  if (status === 'completed') {
    return (
      <CircleCheckBig
        className={cn('size-4 text-[var(--units-green)]', className)}
      />
    )
  }

  if (status === 'failed') {
    return (
      <CircleX className={cn('size-4 text-[var(--units-red)]', className)} />
    )
  }

  if (status === 'waiting') {
    return (
      <CirclePause
        className={cn('size-4 text-[var(--units-orange)]', className)}
      />
    )
  }

  if (status === 'in-progress') {
    return <InProgressStatusIcon value={value} className={className} />
  }

  return <BacklogStatusIcon />
}
