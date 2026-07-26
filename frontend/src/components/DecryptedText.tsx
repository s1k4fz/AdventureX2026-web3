import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

export const DEFAULT_SCRAMBLE_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+'

/** Full-width scramble glyphs: keeps CJK copy from width-jittering mid-decrypt. */
export const CJK_SCRAMBLE_CHARS =
  '０１２３４５６７８９ＡＢＣＤＥＦ＊＃＄％＆＠▚▞▨▧□'

export interface DecryptedTextProps {
  text: string
  /** Time in ms between iterations. */
  speed?: number
  /** Max random iterations in non-sequential mode. */
  maxIterations?: number
  /** Reveal one character at a time instead of settling all at once. */
  sequential?: boolean
  revealDirection?: 'start' | 'end' | 'center'
  /** Restrict scrambling to characters already present in the text. */
  useOriginalCharsOnly?: boolean
  characters?: string
  /** Class for revealed characters. */
  className?: string
  /** Class for the outer wrapper. */
  parentClassName?: string
  /** Class for still-encrypted characters. */
  encryptedClassName?: string
  animateOn?: 'view' | 'hover'
}

/**
 * Decrypt/scramble text reveal, adapted from React Bits <DecryptedText />.
 * Trimmed to the two triggers this app uses (`view` for loading copy, `hover`
 * for playful labels), re-runs automatically when `text` changes (rotating
 * loading hints), and falls back to plain text under prefers-reduced-motion.
 */
export function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = 'start',
  useOriginalCharsOnly = false,
  characters = DEFAULT_SCRAMBLE_CHARS,
  className = '',
  parentClassName = '',
  encryptedClassName = '',
  animateOn = 'hover',
}: DecryptedTextProps) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLSpanElement>(null)

  const [displayText, setDisplayText] = useState(text)
  const [isAnimating, setIsAnimating] = useState(false)
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())
  const [hasAnimated, setHasAnimated] = useState(false)
  const [inView, setInView] = useState(false)
  const [prevText, setPrevText] = useState(text)

  const availableChars = useMemo(
    () =>
      useOriginalCharsOnly
        ? Array.from(new Set(text.split(''))).filter((char) => char !== ' ')
        : characters.split(''),
    [useOriginalCharsOnly, text, characters]
  )

  // Adjust-state-on-prop-change (render phase, per React docs): a new text —
  // e.g. the next rotating hint — resets the run so it decrypts again.
  if (prevText !== text) {
    setPrevText(text)
    setDisplayText(text)
    setRevealed(new Set())
    setHasAnimated(false)
    setIsAnimating(false)
  }

  // View trigger: start (or restart after a text change) once visible.
  if (animateOn === 'view' && inView && !hasAnimated && !reduceMotion) {
    setHasAnimated(true)
    setRevealed(new Set())
    setIsAnimating(true)
  }

  useEffect(() => {
    if (!isAnimating) return undefined

    const shuffle = (currentRevealed: Set<number>) =>
      text
        .split('')
        .map((char, i) => {
          if (char === ' ') return ' '
          if (currentRevealed.has(i)) return char
          return availableChars[
            Math.floor(Math.random() * availableChars.length)
          ]
        })
        .join('')

    const getNextIndex = (revealedSet: Set<number>) => {
      const len = text.length
      switch (revealDirection) {
        case 'end':
          return len - 1 - revealedSet.size
        case 'center': {
          const middle = Math.floor(len / 2)
          const offset = Math.floor(revealedSet.size / 2)
          const nextIndex =
            revealedSet.size % 2 === 0 ? middle + offset : middle - offset - 1
          if (nextIndex >= 0 && nextIndex < len && !revealedSet.has(nextIndex)) {
            return nextIndex
          }
          for (let i = 0; i < len; i++) {
            if (!revealedSet.has(i)) return i
          }
          return 0
        }
        default:
          return revealedSet.size
      }
    }

    let iteration = 0
    const id = window.setInterval(() => {
      setRevealed((prev) => {
        if (sequential) {
          if (prev.size < text.length) {
            const next = new Set(prev)
            next.add(getNextIndex(prev))
            setDisplayText(shuffle(next))
            return next
          }
          window.clearInterval(id)
          setIsAnimating(false)
          setDisplayText(text)
          return prev
        }
        iteration += 1
        if (iteration >= maxIterations) {
          window.clearInterval(id)
          setIsAnimating(false)
          setDisplayText(text)
        } else {
          setDisplayText(shuffle(prev))
        }
        return prev
      })
    }, speed)

    return () => window.clearInterval(id)
  }, [
    isAnimating,
    text,
    speed,
    maxIterations,
    sequential,
    revealDirection,
    availableChars,
  ])

  useEffect(() => {
    if (animateOn !== 'view') return undefined
    const node = containerRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [animateOn])

  const hoverProps =
    animateOn === 'hover' && !reduceMotion
      ? {
          onMouseEnter: () => {
            if (isAnimating) return
            setRevealed(new Set())
            setIsAnimating(true)
          },
          onMouseLeave: () => {
            setIsAnimating(false)
            setRevealed(new Set())
            setDisplayText(text)
          },
        }
      : {}

  if (reduceMotion) {
    return (
      <span className={cn('inline-block', parentClassName, className)}>
        {text}
      </span>
    )
  }

  return (
    <span
      ref={containerRef}
      className={cn('inline-block whitespace-pre-wrap', parentClassName)}
      {...hoverProps}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {displayText.split('').map((char, index) => {
          const done = revealed.has(index) || !isAnimating
          return (
            <span
              key={index}
              className={done ? className : encryptedClassName}
            >
              {char}
            </span>
          )
        })}
      </span>
    </span>
  )
}
