import { useCallback, useState, type RefCallback } from 'react'

/**
 * Sync Radix `data-state` into React for motion enter/exit.
 *
 * Uses a callback ref so attachment retries when `asChild` / Portal finally
 * mounts the DOM node. A plain `useRef` + `useEffect` can miss the first paint
 * (ref still null) and never observe `data-state`, leaving overlays clickable
 * while panel content stays `pointer-events: none` off-screen.
 */
export function useDataStateOpen(
  enabled = true
): [boolean, RefCallback<HTMLElement | null>] {
  const [open, setOpen] = useState(false)

  const ref = useCallback<RefCallback<HTMLElement | null>>(
    (el) => {
      if (!enabled || !el) {
        setOpen(false)
        return
      }

      const sync = () => setOpen(el.getAttribute('data-state') === 'open')
      sync()
      const obs = new MutationObserver(sync)
      obs.observe(el, { attributes: true, attributeFilter: ['data-state'] })
      return () => {
        obs.disconnect()
      }
    },
    [enabled]
  )

  return [open, ref]
}
