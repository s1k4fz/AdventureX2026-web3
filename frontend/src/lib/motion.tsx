import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
  type Variants,
} from 'motion/react'
import { Children, useMemo, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** 进场 / 列表 stagger：可感知、低过冲 */
export const unitsSpringSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.85,
}

/** 菜单开关 / 浮层：更干脆 */
export const unitsSpringSnap: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.7,
}

/** layout / 阶段切换：避免大幅弹跳 */
export const unitsSpringLayout: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 40,
  mass: 0.9,
}

export const unitsStagger = 0.055

const instant: Transition = { duration: 0 }

export function useUnitsMotion() {
  const reduce = useReducedMotion()
  return useMemo(
    () => ({
      reduce: Boolean(reduce),
      soft: reduce ? instant : unitsSpringSoft,
      snap: reduce ? instant : unitsSpringSnap,
      layout: reduce ? instant : unitsSpringLayout,
      stagger: reduce ? 0 : unitsStagger,
      y: reduce ? 0 : 8,
      scaleFrom: reduce ? 1 : 0.96,
    }),
    [reduce]
  )
}

export const revealVariants: Variants = {
  hidden: (y: number) => ({ opacity: 0, y }),
  visible: { opacity: 1, y: 0 },
  exit: (y: number) => ({ opacity: 0, y: -(y || 8) * 0.5 }),
}

type RevealProps = {
  children: ReactNode
  className?: string
  delay?: number
} & Omit<HTMLMotionProps<'div'>, 'children' | 'className'>

export function MotionReveal({
  children,
  className,
  delay = 0,
  ...rest
}: RevealProps) {
  const { soft, y, reduce } = useUnitsMotion()

  return (
    <motion.div
      className={className}
      custom={y}
      variants={revealVariants}
      initial={reduce ? false : 'hidden'}
      animate="visible"
      exit={reduce ? undefined : 'exit'}
      transition={{ ...soft, delay: reduce ? 0 : delay }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export function MotionStagger({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const { soft, stagger, y, reduce } = useUnitsMotion()

  return (
    <motion.div
      className={className}
      initial={reduce ? false : 'hidden'}
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: stagger,
            delayChildren: reduce ? 0 : 0.04,
          },
        },
      }}
    >
      {Children.map(children, (child, index) => {
        if (child == null) return child
        return (
          <motion.div
            key={index}
            custom={y}
            variants={revealVariants}
            transition={soft}
            className="h-full min-w-0"
          >
            {child}
          </motion.div>
        )
      })}
    </motion.div>
  )
}

/** 路由进场淡入（仅 enter；避免与 Outlet 共用时 exit 内容错位） */
export function RouteFade({
  children,
  routeKey,
  className,
}: {
  children: ReactNode
  routeKey: string
  className?: string
}) {
  const { soft, y, reduce } = useUnitsMotion()

  return (
    <motion.div
      key={routeKey}
      className={cn('h-full min-h-0', className)}
      initial={reduce ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
    >
      {children}
    </motion.div>
  )
}

export { AnimatePresence, motion }
