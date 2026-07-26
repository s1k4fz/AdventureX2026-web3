import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'
import type { DitherProps } from './Dither'

const LazyDither = lazy(() => import('./Dither'))

export type DitherVariant = 'calm' | 'active' | 'planning' | 'error'

interface DitherPreset {
  waveColor: [number, number, number]
  waveSpeed: number
  waveAmplitude: number
  waveFrequency: number
  colorNum: number
  opacity: number
}

// 品牌色（Units 橙/蓝紫/红）近似 RGB(0-1)，配合 mix-blend-mode: screen 呈柔和光晕。
const PRESETS: Record<DitherVariant, DitherPreset> = {
  calm: {
    waveColor: [0.95, 0.5, 0.22],
    waveSpeed: 0.016,
    waveAmplitude: 0.24,
    waveFrequency: 3,
    colorNum: 4,
    opacity: 0.3,
  },
  active: {
    waveColor: [1.0, 0.42, 0.12],
    waveSpeed: 0.06,
    waveAmplitude: 0.36,
    waveFrequency: 3,
    colorNum: 4,
    opacity: 0.42,
  },
  planning: {
    waveColor: [0.5, 0.55, 0.98],
    waveSpeed: 0.05,
    waveAmplitude: 0.32,
    waveFrequency: 3,
    colorNum: 4,
    opacity: 0.4,
  },
  error: {
    waveColor: [0.94, 0.28, 0.28],
    waveSpeed: 0,
    waveAmplitude: 0.26,
    waveFrequency: 3,
    colorNum: 3,
    opacity: 0.3,
  },
}

/** 无 WebGL / 加载失败时静默降级，不影响页面其余部分。 */
class DitherBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}

export interface DitherBackgroundProps {
  variant?: DitherVariant
  /** 是否持续动画；与 prefers-reduced-motion 取与。false 时只渲染静态一帧。 */
  animate?: boolean
  /** 覆盖预设透明度。 */
  opacity?: number
  /** 是否开启鼠标交互（仅落地页 Hero 建议开启）。 */
  interactive?: boolean
  className?: string
  /** 应用 mix-blend-mode: screen（默认开），使深色底不压暗页面。 */
  blend?: boolean
}

/**
 * 绝对定位的 Dither 背景层：懒加载 three.js，pointer-events-none，
 * active 态持续渲染，静止时切 demand 只按需绘制一帧（零持续 GPU）。
 */
export function DitherBackground({
  variant = 'calm',
  animate = true,
  opacity,
  interactive = false,
  className,
  blend = true,
}: DitherBackgroundProps) {
  const reducedMotion = useReducedMotion()
  const preset = PRESETS[variant]
  const shouldAnimate = animate && !reducedMotion && variant !== 'error'
  const resolvedOpacity = opacity ?? preset.opacity

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className
      )}
      style={{
        opacity: resolvedOpacity,
        mixBlendMode: blend ? 'screen' : undefined,
      }}
    >
      <DitherBoundary>
        <Suspense fallback={null}>
          <LazyDither
            waveColor={preset.waveColor}
            waveSpeed={preset.waveSpeed}
            waveAmplitude={preset.waveAmplitude}
            waveFrequency={preset.waveFrequency}
            colorNum={preset.colorNum}
            pixelSize={2}
            disableAnimation={!shouldAnimate}
            enableMouseInteraction={interactive}
            mouseRadius={0.4}
            frameloop={shouldAnimate ? 'always' : 'demand'}
          />
        </Suspense>
      </DitherBoundary>
    </div>
  )
}

export type { DitherProps }
