import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface JourneyLayoutProps {
  canvas: ReactNode
  /** Constrain to parent height (agent workbench); omit in flowing embeds. */
  fillHeight?: boolean
  className?: string
}

/** Flow rail + adaptive main canvas. */
export function JourneyLayout({
  canvas,
  fillHeight = false,
  className,
}: JourneyLayoutProps) {
  return (
    <div
      className={cn(
        'units-policy-core relative flex min-h-0 w-full flex-col',
        fillHeight ? 'h-full overflow-hidden' : 'md:min-h-[32rem]',
        className
      )}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,#fff_88%,var(--units-soft))]">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {canvas}
        </div>
      </div>
    </div>
  )
}
