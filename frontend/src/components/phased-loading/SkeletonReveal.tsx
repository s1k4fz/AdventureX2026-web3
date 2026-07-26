import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SkeletonRevealProps {
  loading: boolean
  children: ReactNode
  className?: string
}

export function SkeletonReveal({
  loading,
  children,
  className,
}: SkeletonRevealProps) {
  return (
    <div className={cn('relative', className)}>
      {loading ? (
        <div
          className="absolute inset-0 z-[1] rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-soft)] motion-reduce:opacity-100"
          aria-hidden
        >
          <div className="flex h-full flex-col gap-2 p-3">
            <div className="h-3 w-2/5 rounded bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]" />
            <div className="h-2.5 w-full rounded bg-[color-mix(in_srgb,var(--units-black)_6%,transparent)]" />
            <div className="h-2.5 w-4/5 rounded bg-[color-mix(in_srgb,var(--units-black)_6%,transparent)]" />
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'transition-opacity duration-500 units-ease motion-reduce:transition-none',
          loading ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        {children}
      </div>
    </div>
  )
}
