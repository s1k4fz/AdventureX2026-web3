import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface SidebarItemProps {
  icon?: LucideIcon
  label: string
  to?: string
  end?: boolean
  onClick?: () => void
}

export function SidebarItem({
  icon: Icon,
  label,
  to,
  end,
  onClick,
}: SidebarItemProps) {
  const content = (
    <>
      {Icon && <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />}
      <span className="truncate">{label}</span>
    </>
  )

  const classes = (isActive: boolean) =>
    cn(
      'flex h-9 w-full items-center gap-2 rounded-sm px-3 text-sm transition-colors',
      isActive
        ? 'bg-zinc-200/80 text-black dark:bg-zinc-800/80 dark:text-zinc-50'
        : 'text-black hover:bg-zinc-200/70 dark:text-zinc-50 dark:hover:bg-zinc-800/70'
    )

  if (to) {
    return (
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) => classes(isActive)}
        onClick={onClick}
      >
        {content}
      </NavLink>
    )
  }

  return (
    <button type="button" onClick={onClick} className={classes(false)}>
      {content}
    </button>
  )
}
