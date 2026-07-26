import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  CJK_SCRAMBLE_CHARS,
  DecryptedText,
} from '@/components/DecryptedText'
import { cn } from '@/lib/utils'

/**
 * Milliseconds elapsed since `active` became true; resets when it turns off.
 * Ticks twice per second so elapsed badges stay fresh without churn.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared elapsed hook lives with its status component
export function useElapsedMs(active: boolean): number {
  const startRef = useRef<number | null>(null)
  const [, tick] = useState(0)

  if (active) {
    startRef.current ??= performance.now()
  } else {
    startRef.current = null
  }

  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(() => tick((value) => value + 1), 500)
    return () => window.clearInterval(id)
  }, [active])

  return startRef.current == null ? 0 : performance.now() - startRef.current
}

export interface StageLiveStatusProps {
  /** Rotating one-line descriptions of what the system is doing right now. */
  hints: string[]
  /** Static reassurance line under the rotating hint (expectations, next step). */
  note?: string
  /** Show "已进行 n 秒" so long waits feel accounted for. */
  showElapsed?: boolean
  intervalMs?: number
  className?: string
}

/**
 * Live activity line for in-progress stages: spinner + rotating hint +
 * elapsed time. Gives users a moving narrative instead of a frozen skeleton.
 */
export function StageLiveStatus({
  hints,
  note,
  showElapsed = true,
  intervalMs = 3200,
  className,
}: StageLiveStatusProps) {
  const [hintIndex, setHintIndex] = useState(0)
  const elapsedMs = useElapsedMs(true)

  useEffect(() => {
    if (hints.length <= 1) return undefined
    const id = window.setInterval(
      () => setHintIndex((value) => (value + 1) % hints.length),
      intervalMs
    )
    return () => window.clearInterval(id)
  }, [hints.length, intervalMs])

  const hint = hints[Math.min(hintIndex, hints.length - 1)] ?? ''
  const elapsedSeconds = Math.floor(elapsedMs / 1000)

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex min-w-0 flex-col gap-1', className)}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--units-orange)]" />
        <span
          key={hint}
          className="units-stage-enter min-w-0 truncate text-[13px] font-medium text-foreground"
        >
          <DecryptedText
            text={hint}
            animateOn="view"
            sequential
            speed={28}
            characters={CJK_SCRAMBLE_CHARS}
            encryptedClassName="text-muted-foreground/60"
          />
        </span>
        {showElapsed && elapsedSeconds >= 3 ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            已进行 {elapsedSeconds} 秒
          </span>
        ) : null}
      </div>
      {note ? (
        <p className="pl-[22px] text-[12px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  )
}
