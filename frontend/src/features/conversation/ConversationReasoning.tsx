import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import {
  Brain,
  CheckCircle2,
  Layers,
  Search,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { TypingIndicator } from '@/components/TypingIndicator'
import { cn } from '@/lib/utils'
import { splitReasoningSteps } from './splitReasoningSteps'

const AUTO_CLOSE_DELAY = 1400
const MS_IN_S = 1000
const streamdownPlugins = { cjk, code, math, mermaid }

export type ThinkingTraceStepKind =
  | 'reasoning'
  | 'tool'
  | 'search'
  | 'context'
  | 'compose'

export interface ThinkingTraceStep {
  id: string
  kind: ThinkingTraceStepKind
  label: string
  description?: string
  status?: 'complete' | 'active' | 'pending'
}

const KIND_ICON: Record<ThinkingTraceStepKind, LucideIcon> = {
  reasoning: Brain,
  tool: Wrench,
  search: Search,
  context: Layers,
  compose: CheckCircle2,
}

function getThinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) {
    return (
      <span className="inline-flex items-center gap-2">
        xEngine 思考中
        <TypingIndicator label="正在思考" />
      </span>
    )
  }
  if (duration === undefined) {
    return <span>思考过程</span>
  }
  return <span>思考用时 {duration}s · 可展开回看</span>
}

function StepMarkdown({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  return (
    <Streamdown
      mode={isStreaming ? 'streaming' : 'static'}
      isAnimating={isStreaming}
      parseIncompleteMarkdown={isStreaming}
      dir="auto"
      plugins={streamdownPlugins}
      className="min-w-0 text-[13px] leading-6 text-zinc-500 [&_p]:mt-[10px] [&_p:first-child]:mt-0 [&_ul]:my-1 [&_ol]:my-1"
    >
      {content}
    </Streamdown>
  )
}

/**
 * Collapsible, staged display of Agent reasoning (+ optional intermediate
 * tool/context steps). Prefer readable sections over a single JSON dump.
 */
export function ConversationReasoning({
  className,
  content,
  defaultOpen,
  isStreaming = false,
  autoClose = true,
  intermediateSteps = [],
}: {
  className?: string
  content: string
  defaultOpen?: boolean
  isStreaming?: boolean
  /** When false, keep the panel expanded after streaming ends. */
  autoClose?: boolean
  /** Extra pipeline events (tool mount, market search, etc.). */
  intermediateSteps?: ThinkingTraceStep[]
}) {
  const hasContent = content.trim().length > 0
  const hasExtras = intermediateSteps.length > 0
  const [isOpen, setIsOpen] = useState(defaultOpen ?? isStreaming)
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const hasEverStreamedRef = useRef(isStreaming)
  const [hasAutoClosed, setHasAutoClosed] = useState(false)
  const startTimeRef = useRef<number | null>(null)

  const reasoningParts = useMemo(
    () => splitReasoningSteps(content),
    [content]
  )

  if (isStreaming && !isOpen && defaultOpen !== false) {
    setIsOpen(true)
  }

  useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now()
      }
      return
    }

    if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S))
      startTimeRef.current = null
    }
  }, [isStreaming])

  useEffect(() => {
    if (
      !autoClose ||
      !hasEverStreamedRef.current ||
      isStreaming ||
      !isOpen ||
      hasAutoClosed
    ) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setIsOpen(false)
      setHasAutoClosed(true)
    }, AUTO_CLOSE_DELAY)

    return () => {
      window.clearTimeout(timer)
    }
  }, [autoClose, hasAutoClosed, isOpen, isStreaming])

  if (!hasContent && !isStreaming && !hasExtras) {
    return null
  }

  const stepCount = reasoningParts.length + intermediateSteps.length

  return (
    <ChainOfThought
      data-slot="conversation-reasoning"
      className={cn(
        'units-cot-panel mb-0 w-full max-w-[56rem] space-y-0 px-4 py-3.5',
        className
      )}
      onOpenChange={setIsOpen}
      open={isOpen}
    >
      <ChainOfThoughtHeader className="h-auto min-h-7 w-full gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground [&>svg]:size-4">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {getThinkingMessage(isStreaming, duration)}
          {stepCount > 0 && !isStreaming ? (
            <span className="rounded-full border border-[var(--units-stroke-color)] bg-background/70 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {stepCount} 步轨迹
            </span>
          ) : null}
          {isStreaming ? (
            <span className="rounded-full border border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--units-orange)]">
              CoT 流式展开
            </span>
          ) : null}
        </span>
      </ChainOfThoughtHeader>

      <ChainOfThoughtContent className="mt-3.5 space-y-3 border-t border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] pt-3.5">
        {intermediateSteps.map((step) => {
          const Icon = KIND_ICON[step.kind]
          return (
            <ChainOfThoughtStep
              key={step.id}
              icon={Icon}
              label={
                <span className="text-[13px] font-medium text-foreground">
                  {step.label}
                </span>
              }
              description={
                step.description ? (
                  <span className="text-[12px] leading-5 text-muted-foreground">
                    {step.description}
                  </span>
                ) : undefined
              }
              status={step.status ?? (isStreaming ? 'active' : 'complete')}
              className="gap-2.5"
            />
          )
        })}

        {reasoningParts.length === 0 && isStreaming ? (
          <ChainOfThoughtStep
            icon={Brain}
            label={
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                正在展开推理轨迹…
                <TypingIndicator label="推理中" />
              </span>
            }
            status="active"
            className="gap-2.5"
          />
        ) : null}

        {reasoningParts.map((part, index) => {
          const isLast = index === reasoningParts.length - 1
          const status =
            isStreaming && isLast
              ? 'active'
              : 'complete'
          const body = part.body.trim()
          const showBody = body.length > 0 && body !== part.title.trim()
          return (
            <ChainOfThoughtStep
              key={part.id}
              icon={Brain}
              label={
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[12px] font-semibold tracking-wide text-foreground/85">
                    {part.title}
                  </span>
                  {showBody ? (
                    <StepMarkdown
                      content={part.body}
                      isStreaming={Boolean(isStreaming && isLast)}
                    />
                  ) : null}
                </div>
              }
              status={status}
              className="gap-2.5 text-zinc-500"
            />
          )
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
