import { Skeleton } from '@/components/ui/skeleton'

/** 保单看板列表骨架 */
export function PolicyListSkeleton() {
  return (
    <div className="units-stagger grid gap-3" aria-busy="true" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="h-[88px] w-full rounded-xl units-skeleton-shimmer"
        />
      ))}
    </div>
  )
}
