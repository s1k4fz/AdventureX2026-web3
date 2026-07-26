import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { useUnitsMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

type SlideDirection = 'next' | 'prev' | 'none'

interface ScheduleViewTransitionProps {
  viewKey: string
  direction?: SlideDirection
  className?: string
  children: ReactNode
}

/** 视图切换 / 周期翻页：小位移 Units spring */
export function ScheduleViewTransition({
  viewKey,
  direction = 'none',
  className,
  children,
}: ScheduleViewTransitionProps) {
  const { soft, reduce } = useUnitsMotion()
  const x =
    direction === 'next' ? 12 : direction === 'prev' ? -12 : 0
  const y = direction === 'none' ? 6 : 0

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={viewKey}
        className={cn('h-full min-h-0', className)}
        initial={reduce ? false : { opacity: 0, x, y }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, x: -x * 0.4, y: -y * 0.4 }}
        transition={soft}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
