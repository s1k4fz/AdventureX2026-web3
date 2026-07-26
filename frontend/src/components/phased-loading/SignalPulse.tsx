import { cn } from '@/lib/utils'

export interface SignalPulseProps {
  className?: string
  count?: number
}

export function SignalPulse({ className, count = 3 }: SignalPulseProps) {
  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      role="status"
      aria-label="信号同步中"
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={cn(
            'size-1.5 rounded-full bg-[var(--units-orange)]',
            'phased-signal-pulse motion-reduce:scale-100 motion-reduce:opacity-70'
          )}
          style={{ animationDelay: `${index * 0.18}s` }}
        />
      ))}
    </div>
  )
}
