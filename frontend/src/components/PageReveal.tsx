import type { ReactNode } from 'react'

import { MotionReveal } from '@/lib/motion'

/** 页面进入：轻微上移 + fade，Units soft spring；尊重 prefers-reduced-motion */
export function PageReveal({
  children,
  className,
  delaySeconds = 0,
}: {
  children: ReactNode
  className?: string
  delaySeconds?: number
}) {
  return (
    <MotionReveal className={className} delay={delaySeconds}>
      {children}
    </MotionReveal>
  )
}
