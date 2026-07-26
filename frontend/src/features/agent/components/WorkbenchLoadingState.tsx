import { cn } from '@/lib/utils'

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('units-skeleton-shimmer rounded-xl', className)}
    />
  )
}

/**
 * 工作台加载骨架：左侧步骤轨道 + 右侧产物画布占位。
 * 不预设阶段（问卷 / 检索 / 方案 / 链上均适用），替代旧的会话式加载态。
 */
export function WorkbenchLoadingState({
  message = '正在加载工作台…',
  hint = '同步任务进度与产物画布',
  className,
}: {
  message?: string
  hint?: string | null
  className?: string
}) {
  return (
    <div
      aria-busy="true"
      className={cn(
        'units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label={message}
        className="flex min-h-0 flex-1"
      >
        {/* 步骤轨道骨架（桌面端） */}
        <div
          aria-hidden
          className="hidden w-56 shrink-0 flex-col gap-1 border-e border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] px-3 py-4 lg:flex"
        >
          <ShimmerBlock className="mb-3 h-3.5 w-20 rounded-sm" />
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-3 px-1 py-2">
              <ShimmerBlock className="size-6 shrink-0 rounded-full" />
              <ShimmerBlock className="h-3.5 flex-1 rounded-sm" />
            </div>
          ))}
        </div>

        {/* 画布骨架 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="mx-auto flex w-full max-w-[55rem] flex-col gap-6 px-6 py-5">
            <div className="units-stage-enter flex items-center gap-2.5 text-sm">
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                <span className="units-loading-ring absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] border-t-[var(--units-orange)]" />
              </span>
              <span className="font-medium text-foreground">{message}</span>
            </div>

            <div className="units-stagger flex flex-col gap-5" aria-hidden>
              <ShimmerBlock className="h-[76px] w-full max-w-[42rem] rounded-2xl" />
              <div className="flex max-w-[42rem] flex-col gap-2.5">
                <ShimmerBlock className="h-4 w-11/12 rounded-sm" />
                <ShimmerBlock className="h-4 w-4/5 rounded-sm" />
                <ShimmerBlock className="h-4 w-3/5 rounded-sm" />
              </div>
              <ShimmerBlock className="h-[132px] w-full max-w-[36rem] rounded-2xl" />
            </div>

            {hint ? (
              <p className="text-[12px] text-muted-foreground">{hint}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
