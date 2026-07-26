import { useMemo, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

import {
  getPixelCells,
  PIXEL_COLUMNS,
  PIXEL_ROWS,
  type PixelPattern,
} from './patterns'

const SIZE_CLASS = {
  xs: 'w-[72px]',
  sm: 'w-[112px]',
  md: 'w-[168px]',
  lg: 'w-full max-w-[240px]',
} as const

/**
 * Units 像素图形 — 自 nchs-ai-site `PixelGrid.astro` 适配为 React。
 * `live`：图案切换时平滑过渡色块；`animate`：填色格错落入场。
 */
export function PixelArt({
  pattern = 'spark',
  label,
  live = false,
  animate = false,
  size = 'md',
  className,
}: {
  pattern?: PixelPattern
  label?: string
  live?: boolean
  animate?: boolean
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  const cells = useMemo(() => getPixelCells(pattern), [pattern])

  return (
    <div
      className={cn('units-pixel-art', SIZE_CLASS[size], className)}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-units-pixel-live={live ? 'true' : undefined}
      data-units-pixel-animate={animate ? 'true' : undefined}
      style={
        {
          '--pixel-columns': PIXEL_COLUMNS,
          '--pixel-rows': PIXEL_ROWS,
        } as CSSProperties
      }
    >
      {cells.map((tone, index) => (
        <span
          key={index}
          className={cn('units-pixel-art__cell', tone && `is-${tone}`)}
          style={
            tone
              ? ({ '--cell-i': index } as CSSProperties)
              : undefined
          }
        />
      ))}
    </div>
  )
}
