import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  Gem,
  Home,
  type LucideIcon,
  Plus,
  PlusCircle,
  Vault,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { RouteFade } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SidebarItem } from '@/components/SidebarItem'
import { AgentTaskSidebar } from '@/features/agent/components/AgentTaskSidebar'

interface MobileNavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  primary?: boolean
}

const MOBILE_NAV: MobileNavItem[] = [
  { to: '/home', label: '看板', icon: Home, end: true },
  { to: '/collection', label: '藏品', icon: Gem },
  { to: '/tasks/new', label: '新任务', icon: Plus, primary: true },
  { to: '/vault', label: '金库', icon: Vault },
]

function SidebarHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center bg-zinc-100 px-3 dark:bg-sidebar">
      <Button variant="ghost" size="icon-sm" aria-label="首页" asChild>
        <Link to="/home">
          <img src="/logo.svg" alt="xEngine" className="size-5 rounded-[5px]" />
        </Link>
      </Button>
      <span className="units-text-body font-display font-semibold tracking-tight text-foreground">
        xEngine
      </span>
    </header>
  )
}

export function AppLayout() {
  const navRef = useRef<HTMLElement>(null)
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false)
  const location = useLocation()
  const routeKey = `${location.pathname}${location.search}`

  const handleScroll = useCallback(() => {
    const el = navRef.current
    if (!el) return
    setIsScrolledFromTop(el.scrollTop > 0)
  }, [])

  useEffect(() => {
    const el = navRef.current
    if (!el) return
    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  return (
    <div className="flex h-[100dvh] gap-2 overflow-hidden bg-zinc-100 p-2 pb-[4.75rem] text-zinc-950 [--sidebar-width:240px] dark:bg-sidebar dark:text-zinc-50 md:pb-2">
      <aside className="hidden h-full w-[var(--sidebar-width)] shrink-0 flex-col md:flex">
        <nav ref={navRef} className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
          <SidebarHeader />

          <div className="sticky top-14 z-10 flex flex-col gap-0.5 bg-zinc-100 dark:bg-sidebar">
            <div className="pb-2">
              <Button
                asChild
                variant="ghost"
                className="w-full justify-center gap-2 rounded-sm border border-[var(--units-stroke-color)] bg-[var(--units-orange)] font-semibold text-[var(--units-on-accent)] shadow-none hover:bg-[color-mix(in_srgb,var(--units-orange)_88%,var(--units-black))] hover:text-[var(--units-on-accent)]"
              >
                <Link to="/tasks/new">
                  <PlusCircle className="size-[18px]" strokeWidth={2} />
                  发起投保
                </Link>
              </Button>
            </div>
            <SidebarItem icon={Home} label="保单看板" to="/home" end />
            <SidebarItem icon={CalendarDays} label="日程" to="/schedule" />
            <SidebarItem icon={Gem} label="NFT 藏品" to="/collection" />
            <SidebarItem icon={Vault} label="金库" to="/vault" />
            <div
              className={cn(
                'pointer-events-none h-px w-full shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-opacity duration-150',
                isScrolledFromTop ? 'opacity-100' : 'opacity-0'
              )}
            />
          </div>

          <AgentTaskSidebar />
        </nav>
      </aside>

      <main className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <RouteFade routeKey={routeKey}>
          <Outlet />
        </RouteFade>
      </main>
      <nav
        aria-label="主要导航"
        className="fixed inset-x-2 bottom-2 z-50 grid h-16 grid-cols-4 items-center rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-sidebar/95 px-1.5 shadow-none backdrop-blur-xl md:hidden"
      >
        {MOBILE_NAV.map((item) =>
          item.primary ? (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className="flex flex-col items-center justify-center"
            >
              <span className="flex size-11 items-center justify-center rounded-full border border-[var(--units-stroke-color)] bg-[var(--units-orange)] text-[var(--units-on-accent)] shadow-none">
                <item.icon className="size-5" strokeWidth={2.4} />
              </span>
            </NavLink>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-[var(--units-orange)]'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <item.icon className="size-[18px]" strokeWidth={1.9} />
              <span className="truncate">{item.label}</span>
            </NavLink>
          )
        )}
      </nav>
    </div>
  )
}
