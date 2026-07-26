import { cn } from '@/lib/utils'

export interface TrackFlowLineProps {
  className?: string
  orientation?: 'vertical' | 'horizontal'
}

export function TrackFlowLine({
  className,
  orientation = 'vertical',
}: TrackFlowLineProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'phased-track-flow rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)] motion-reduce:opacity-60',
        orientation === 'vertical' ? 'h-12 w-0.5' : 'h-0.5 w-12',
        className
      )}
    />
  )
}
