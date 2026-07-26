import { useCallback, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

interface AddressTextProps {
  address: string
  head?: number
  tail?: number
  className?: string
  size?: 'sm' | 'md'
  /** When true, clicking the text toggles inline expand/collapse. */
  expandable?: boolean
}

const addressSizeClass = (size: 'sm' | 'md') =>
  size === 'sm' ? 'text-[11px]' : 'text-[12.5px]'

/**
 * Inline address display with click-to-expand.
 * Default: truncated `0x523e…3cd4`. Click toggles full address inline with
 * smooth max-width animation. No hover popup — avoids overflow/z-index issues.
 */
export function AddressText({
  address,
  head = 6,
  tail = 4,
  className,
  size = 'md',
  expandable = false,
}: AddressTextProps) {
  const [expanded, setExpanded] = useState(false)
  const sizeClass = addressSizeClass(size)
  const compact = address.length <= head + tail + 1

  if (compact) {
    return (
      <span
        className={cn(
          'units-address-text truncate font-medium text-foreground',
          sizeClass,
          className
        )}
      >
        {address}
      </span>
    )
  }

  const headText = address.slice(0, head)
  const tailText = address.slice(-tail)

  const handleToggle = expandable
    ? () => setExpanded((prev) => !prev)
    : undefined

  return (
    <span
      className={cn(
        'units-address-inline',
        expandable && 'cursor-pointer',
        sizeClass,
        className
      )}
      onClick={handleToggle}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      onKeyDown={
        expandable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setExpanded((prev) => !prev)
              }
            }
          : undefined
      }
      aria-expanded={expandable ? expanded : undefined}
      aria-label={expandable ? `展开地址 ${address}` : undefined}
    >
      <span
        className={cn(
          'units-address-inline-content',
          expanded && 'units-address-inline-content--expanded'
        )}
      >
        <span className="units-address-head">{headText}</span>
        {expanded ? (
          <span className="units-address-mid">
            {address.slice(head, -tail)}
          </span>
        ) : (
          <span className="units-address-sep">…</span>
        )}
        <span className="units-address-tail">{tailText}</span>
      </span>
    </span>
  )
}

interface CopyableAddressProps {
  address: string
  head?: number
  tail?: number
  className?: string
  size?: 'sm' | 'md'
}

export function CopyableAddress({
  address,
  head = 6,
  tail = 4,
  className,
  size = 'md',
}: CopyableAddressProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const ok = await copyText(address)
      if (!ok) return
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1600)
    },
    [address]
  )

  return (
    <span
      className={cn('units-address group', className)}
      data-copied={copied ? 'true' : undefined}
    >
      <AddressText
        address={address}
        head={head}
        tail={tail}
        size={size}
        expandable
      />
      <button
        type="button"
        onClick={(e) => void handleCopy(e)}
        className="units-address-copy-btn"
        title={copied ? '已复制' : `复制 ${address}`}
        aria-label={copied ? `已复制地址 ${address}` : `复制地址 ${address}`}
      >
        {copied ? (
          <Check className="size-3.5 text-[var(--units-green)]" aria-hidden />
        ) : (
          <Copy className="size-3.5 opacity-50 transition-opacity group-hover:opacity-80" aria-hidden />
        )}
      </button>
      {copied && (
        <span className="units-address-hint text-[var(--units-green)]">已复制</span>
      )}
    </span>
  )
}
