import { cn } from '@/lib/utils'

/** 三点脉冲：流式等待 / 思考指示 */
export function TypingIndicator({
  className,
  label = '处理中',
}: {
  className?: string
  label?: string
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}
    >
      <span className="units-typing-dot" />
      <span className="units-typing-dot" />
      <span className="units-typing-dot" />
    </span>
  )
}
