import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ActionChipProps {
  icon: LucideIcon
  iconColor: string
  label: string
  onClick?: () => void
  /** 情境化计数：>0 时以强调色气泡显示，用于「待结算」等待办提示 */
  badge?: number
  /** 用作气泡与描边的强调色，默认沿用 iconColor */
  accent?: string
}

export function ActionChip({
  icon: Icon,
  iconColor,
  label,
  onClick,
  badge,
  accent,
}: ActionChipProps) {
  const showBadge = typeof badge === 'number' && badge > 0
  const badgeColor = accent ?? iconColor

  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={cn(
        'h-8 gap-1.5 rounded-full border-zinc-200 bg-white px-4 font-normal text-zinc-900 shadow-none hover:bg-zinc-50',
        showBadge && 'pr-2.5'
      )}
    >
      <Icon className="size-4" style={{ color: iconColor }} />
      {label}
      {showBadge ? (
        <span
          className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: badgeColor }}
        >
          {badge}
        </span>
      ) : null}
    </Button>
  )
}
