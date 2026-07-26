import { useState, useRef, useEffect, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarSectionProps {
  title: string
  /** Optional item count rendered as a small badge next to the title. */
  count?: number
  defaultOpen?: boolean
  forceClosed?: boolean
  showLine?: boolean
  children: ReactNode
}

export function SidebarSection({
  title,
  count,
  defaultOpen = true,
  forceClosed = false,
  showLine = true,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  const isOpen = !forceClosed && open

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    setHeight(el.scrollHeight)
    // Track inner size changes (e.g. nested "show all" toggles), not just children prop swaps.
    const observer = new ResizeObserver(() => {
      setHeight(el.scrollHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          if (!forceClosed) {
            setOpen((prev) => !prev)
          }
        }}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        {typeof count === 'number' && count > 0 ? (
          <span className="rounded-full bg-zinc-200/80 px-1.5 py-px text-[10px] font-semibold tabular-nums leading-4 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {count}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            'size-3.5 text-zinc-400 transition-transform duration-150 dark:text-zinc-500',
            isOpen && 'rotate-90'
          )}
        />
      </button>

      <div
        className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
        style={{ maxHeight: isOpen ? height ?? 'none' : 0 }}
      >
        <div ref={contentRef} className={cn('relative flex flex-col gap-0.5', showLine && 'pl-7')}>
          {showLine && <div className="absolute top-0 bottom-0 left-[18px] w-px bg-zinc-300 dark:bg-zinc-700" />}
          {children}
        </div>
      </div>
    </div>
  )
}
