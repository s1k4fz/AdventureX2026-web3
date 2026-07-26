import { TypingIndicator } from '@/components/TypingIndicator'
import { cn } from '@/lib/utils'

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('units-skeleton-shimmer rounded-xl', className)} />
  )
}

/**
 * 通用会话加载态：不预设阶段（问卷 / 检索 / 方案 / 链上均适用）。
 * 以会话骨架（右侧用户气泡 + 左侧回复行 + 产物卡片）占位，
 * 避免恢复历史会话时误现「生成问卷」等新建专属文案。
 */
export function ConversationLoadingState({
  message = '正在加载会话…',
  hint = '恢复历史消息与产物画布',
  withDock = true,
  className,
}: {
  message?: string
  hint?: string | null
  /** 底部渲染输入坞占位，避免加载完成后布局跳动。 */
  withDock?: boolean
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
        className="scrollbar-fade min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[55rem] flex-col gap-7 px-6 py-5">
          <div className="units-stage-enter flex items-center gap-2.5 text-sm">
            <span className="relative flex size-5 shrink-0 items-center justify-center">
              <span className="units-loading-ring absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] border-t-[var(--units-orange)]" />
            </span>
            <span className="font-medium text-foreground">{message}</span>
            <TypingIndicator label={message} />
          </div>

          <div className="units-stagger flex flex-col gap-7" aria-hidden>
            {/* 用户消息气泡 */}
            <div className="flex justify-end">
              <ShimmerBlock className="h-[52px] w-[min(70%,26rem)] rounded-[22px]" />
            </div>

            {/* 回复段落 */}
            <div className="flex max-w-[42rem] flex-col gap-2.5">
              <ShimmerBlock className="h-4 w-11/12 rounded-sm" />
              <ShimmerBlock className="h-4 w-4/5 rounded-sm" />
              <ShimmerBlock className="h-4 w-3/5 rounded-sm" />
            </div>

            {/* 工具 / 产物卡片 */}
            <ShimmerBlock className="h-[132px] w-full max-w-[36rem] rounded-2xl" />
          </div>

          {hint ? (
            <p className="text-[12px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </div>

      {withDock ? (
        <div className="units-workspace-input-dock shrink-0 p-2.5 sm:p-3" aria-hidden>
          <div className="mx-auto w-full max-w-2xl">
            <ShimmerBlock className="h-[52px] w-full rounded-2xl" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
