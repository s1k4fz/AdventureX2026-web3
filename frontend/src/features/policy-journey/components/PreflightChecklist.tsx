import type { ReactNode } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface PreflightCheckItem {
  id: string
  ok: boolean
  label: string
  /** 修复动作（连接钱包 / 切换网络 / 刷新同步等），未通过时展示。 */
  action?: ReactNode
}

/**
 * 通用前置条件清单：未通过项置顶并渲染修复动作。
 * 泛化自链上确认阶段的钱包 / 网络 / 保单就绪三项检查。
 */
export function PreflightChecklist({
  items,
  className,
}: {
  items: PreflightCheckItem[]
  className?: string
}) {
  if (items.length === 0) return null
  // Failing checks first so the fix action is always above the fold.
  const sorted = [...items].sort((a, b) => Number(a.ok) - Number(b.ok))

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {sorted.map((item) => (
        <li
          key={item.id}
          className={cn(
            'units-ease flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-300 motion-reduce:transition-none',
            item.ok
              ? 'border-[var(--units-stroke-color)] bg-[var(--units-wash-strong)]'
              : 'border-[color-mix(in_srgb,var(--units-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_6%,transparent)]'
          )}
        >
          {item.ok ? (
            <CheckCircle2 className="size-4 shrink-0 text-[var(--units-green)]" />
          ) : (
            <CircleAlert className="size-4 shrink-0 text-[var(--units-orange)]" />
          )}
          <span className="min-w-0 flex-1 text-[13.5px] font-medium">
            {item.label}
          </span>
          {!item.ok && item.action ? (
            <span className="shrink-0">{item.action}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
