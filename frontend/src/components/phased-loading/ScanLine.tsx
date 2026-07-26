import { cn } from '@/lib/utils'

export interface ScanLineProps {
  className?: string
  label?: string
}

export function ScanLine({ className, label = '扫描市场中…' }: ScanLineProps) {
  return (
    <div
      className={cn('flex flex-col gap-2', className)}
      role="status"
      aria-label={label}
    >
      <p className="text-[11px] tracking-tight text-muted-foreground">{label}</p>
      <div className="relative h-1.5 overflow-hidden rounded-full border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_80%,transparent)]">
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--units-orange)]',
            'phased-scan-line motion-reduce:left-1/3 motion-reduce:translate-x-0 motion-reduce:transform-none'
          )}
        />
      </div>
    </div>
  )
}
