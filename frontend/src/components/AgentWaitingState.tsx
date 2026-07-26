import { useEffect, useState } from 'react'

import { ProgressStatusIcon } from '@/components/ProgressStatusIcon'
import { TypingIndicator } from '@/components/TypingIndicator'
import { PixelArt, type PixelPattern } from '@/components/pixel'
import { cn } from '@/lib/utils'

export type AgentRunStage =
  | 'init'
  | 'context'
  | 'thinking'
  | 'tools'
  | 'streaming'
  | 'search'
  | 'compose'

const STAGE_COPY: Record<
  AgentRunStage,
  { label: string; hint: string; pattern: PixelPattern }
> = {
  init: {
    label: '初始化通道',
    hint: '建立会话与推理链路',
    pattern: 'spark',
  },
  context: {
    label: '加载全球上下文',
    hint: '拉取 WorldMonitor 情报快照',
    pattern: 'people',
  },
  thinking: {
    label: 'xEngine 思考中',
    hint: '整理诉求与风险画像',
    pattern: 'design',
  },
  tools: {
    label: '调用工具',
    hint: '挂载规划卡片与检索',
    pattern: 'care',
  },
  streaming: {
    label: '生成回复',
    hint: '流式输出中',
    pattern: 'spark',
  },
  search: {
    label: '检索预测市场',
    hint: '广搜 Polymarket 候选',
    pattern: 'design',
  },
  compose: {
    label: '编排保障方案',
    hint: '三档组合与权重校准',
    pattern: 'care',
  },
}

/** Timed progression while waiting for the first token / tool card. */
const AUTO_STAGE_SEQUENCE: AgentRunStage[] = [
  'init',
  'context',
  'thinking',
  'tools',
]

/**
 * Agent 等待态：分阶段进度环 + 时间线 + 打字点。
 * 可显式传入 stage，或按 elapsed 自动推进（聊天首 token 前）。
 */
export function AgentWaitingState({
  message,
  stage,
  autoProgress = true,
  className,
  compact = false,
}: {
  message?: string
  stage?: AgentRunStage
  autoProgress?: boolean
  className?: string
  compact?: boolean
}) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!autoProgress || stage) return undefined
    const started = performance.now()
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - started)
    }, 400)
    return () => window.clearInterval(id)
  }, [autoProgress, stage])

  const autoIndex = Math.min(
    AUTO_STAGE_SEQUENCE.length - 1,
    Math.floor(elapsedMs / 2200)
  )
  const activeStage = stage ?? AUTO_STAGE_SEQUENCE[autoIndex]
  const copy = STAGE_COPY[activeStage]
  const displayMessage = message ?? copy.label

  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'units-stage-enter flex items-center gap-2.5 rounded-full border border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-3.5 py-2 text-sm text-foreground',
          className
        )}
      >
        <PixelArt
          key={copy.pattern}
          pattern={copy.pattern}
          animate
          size="xs"
          className="w-9 shrink-0 rounded-[2px]"
        />
        <span className="font-medium">{displayMessage}</span>
        <TypingIndicator label={displayMessage} className="ml-0.5" />
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'units-stage-enter relative flex w-full max-w-md flex-col gap-3 overflow-hidden rounded-2xl border border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-4 py-3.5 text-foreground',
        className
      )}
    >
      <div className="relative flex items-center gap-3 text-sm">
        <PixelArt
          key={copy.pattern}
          pattern={copy.pattern}
          live
          animate
          size="xs"
          label={copy.label}
          className="shrink-0 rounded-sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="relative flex size-6 shrink-0 items-center justify-center">
              <span className="units-loading-ring absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] border-t-[var(--units-orange)]" />
              <ProgressStatusIcon status="in-progress" className="size-3" />
            </span>
            <p className="font-medium leading-5">{displayMessage}</p>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{copy.hint}</p>
        </div>
        <TypingIndicator label={displayMessage} />
      </div>

      <ol className="units-stagger relative flex flex-col gap-1.5 border-t border-border/60 pt-3">
        {AUTO_STAGE_SEQUENCE.map((key, index) => {
          const item = STAGE_COPY[key]
          const done =
            stage != null
              ? AUTO_STAGE_SEQUENCE.indexOf(activeStage) > index
              : index < autoIndex
          const current = key === activeStage
          return (
            <li
              key={key}
              className={cn(
                'flex items-center gap-2 text-[12px] transition-opacity duration-300',
                current
                  ? 'text-foreground'
                  : done
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/55'
              )}
            >
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  current
                    ? 'units-stage-pulse bg-[var(--units-orange)]'
                    : done
                      ? 'bg-[var(--units-green)]'
                      : 'bg-border'
                )}
              />
              <span className={cn(current && 'font-medium')}>{item.label}</span>
            </li>
          )
        })}
      </ol>

      <div
        className="units-loading-bar relative h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
        aria-hidden
      >
        <div className="units-loading-bar-fill h-full w-1/3 rounded-full bg-[var(--units-orange)]" />
      </div>
    </div>
  )
}

/** Policy compose / search pipeline stage strip. */
export function AgentPipelineStages({
  active,
  className,
}: {
  active: AgentRunStage
  className?: string
}) {
  const pipeline: AgentRunStage[] = ['context', 'search', 'compose', 'streaming']
  const activeIndex = pipeline.indexOf(active)

  return (
    <ol
      className={cn(
        'units-stage-enter flex flex-wrap items-center gap-2',
        className
      )}
    >
      {pipeline.map((key, index) => {
        const item = STAGE_COPY[key]
        const done = activeIndex > index
        const current = key === active
        return (
          <li
            key={key}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-300',
              current
                ? 'border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] text-foreground'
                : done
                  ? 'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_10%,transparent)] text-muted-foreground'
                  : 'border-border bg-transparent text-muted-foreground/60'
            )}
          >
            {current ? (
              <ProgressStatusIcon status="in-progress" className="size-3" />
            ) : (
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  done ? 'bg-[var(--units-green)]' : 'bg-border'
                )}
              />
            )}
            {item.label}
          </li>
        )
      })}
    </ol>
  )
}
