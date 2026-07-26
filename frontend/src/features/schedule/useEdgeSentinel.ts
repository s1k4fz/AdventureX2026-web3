import { useEffect, useRef, type RefObject } from 'react'

interface UseEdgeSentinelOptions {
  root: RefObject<HTMLElement | null>
  onHit: () => void
  enabled?: boolean
  rootMargin?: string
  /** 触发后冷却，避免连发 */
  cooldownMs?: number
}

/** 顶/底哨兵：进入可视区时回调一次（带冷却）。 */
export function useEdgeSentinel({
  root,
  onHit,
  enabled = true,
  rootMargin = '120px 0px',
  cooldownMs = 320,
}: UseEdgeSentinelOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onHitRef = useRef(onHit)
  const coolUntilRef = useRef(0)

  useEffect(() => {
    onHitRef.current = onHit
  }, [onHit])

  useEffect(() => {
    const rootEl = root.current
    const sentinel = sentinelRef.current
    if (!enabled || !rootEl || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        const now = Date.now()
        if (now < coolUntilRef.current) return
        coolUntilRef.current = now + cooldownMs
        onHitRef.current()
      },
      { root: rootEl, rootMargin, threshold: 0 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [root, enabled, rootMargin, cooldownMs])

  return sentinelRef
}
