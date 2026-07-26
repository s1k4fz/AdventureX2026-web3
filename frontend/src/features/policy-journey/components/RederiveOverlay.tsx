import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export interface RederiveOverlayProps {
  timeoutError?: boolean
  onRetry?: () => void
  className?: string
}

export function RederiveOverlay({
  timeoutError,
  onRetry,
  className,
}: RederiveOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--units-soft)_88%,transparent)] backdrop-blur-[2px] motion-reduce:backdrop-blur-none motion-reduce:transition-none',
        className
      )}
    >
      <div className="mx-4 max-w-sm rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-background px-5 py-4 text-center shadow-none">
        {timeoutError ? (
          <>
            <AlertTriangle className="mx-auto mb-2 size-5 text-[var(--units-orange)]" />
            <p className="font-display text-[15px] font-semibold text-foreground">
              推演超时
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              重新推演花费时间较长，你可以稍后再试或重新提交诉求。
            </p>
            {onRetry && (
              <Button
                type="button"
                size="sm"
                onClick={onRetry}
                className="mt-3 rounded-lg border border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] motion-reduce:transition-none"
              >
                重试
              </Button>
            )}
          </>
        ) : (
          <>
            <Spinner className="mx-auto mb-2 size-5 text-[var(--units-orange)]" />
            <p className="font-display text-[15px] font-semibold text-foreground">
              正在按新诉求重新推演
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              方案矩阵将在完成后自动更新
            </p>
          </>
        )}
      </div>
    </div>
  )
}
