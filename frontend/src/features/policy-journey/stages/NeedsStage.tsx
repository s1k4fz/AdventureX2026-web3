import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Check, CheckCheck, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { AgentSubagent } from '@/features/agent/types'
import type {
  PolicyIntakeAnswer,
  QuestionnaireAnswers,
  QuestionnaireQuestion,
  RiskFactorCategory,
} from '@/features/policy/policyApi'
import { cn } from '@/lib/utils'

import { StageLiveStatus, useElapsedMs } from '../components/StageLiveStatus'
import { StageSkeletonBlock } from '../components/StageShell'
import type { StageStatus } from '../types'

const ESCAPE_AFTER_MS = 25_000
const GENERATE_TIMEOUT_MS = 45_000
const AUTO_ADVANCE_DELAY_MS = 240
const QUESTIONNAIRE_WELCOME =
  '先完成一份风险问卷：系统会按你的回答检索预测市场，并编排适合的保障方案。'

const GENERATING_HINTS = [
  '正在分析你的风险描述…',
  '正在识别关键风险因子…',
  '正在为你定制问卷问题…',
  '快好了，正在整理问题选项…',
]

const SUBMITTING_HINTS = [
  '正在记录你的风险偏好…',
  '正在构建风险画像…',
  '即将启动预测市场检索…',
]

/** What happens after the questionnaire — keeps the user oriented in the flow. */
const NEXT_STEPS = [
  { key: 'search', label: '匹配真实预测市场', detail: '按你的回答检索可保障事件' },
  { key: 'signal', label: '并行校验风险信号', detail: '新闻与宏观信号同时核对' },
  { key: 'plan', label: '生成三档保障方案', detail: '由你比较并确认出资' },
] as const

function getSelectedAnswers(
  questions: QuestionnaireQuestion[],
  answers: QuestionnaireAnswers
): PolicyIntakeAnswer[] {
  return questions.flatMap((question) => {
    const answer = answers[question.id]
    return answer ? [{ questionId: question.id, answer }] : []
  })
}

/** Segmented progress: one cell per question, filled once answered. */
function WizardProgress({
  questions,
  answers,
  stepIndex,
}: {
  questions: QuestionnaireQuestion[]
  answers: QuestionnaireAnswers
  stepIndex: number
}) {
  const answeredCount = questions.filter((q) => answers[q.id]).length
  const onReview = stepIndex >= questions.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-foreground">
          {onReview
            ? '确认你的回答'
            : `问题 ${stepIndex + 1} / ${questions.length}`}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          已回答 {answeredCount} / {questions.length}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {questions.map((question, index) => (
          <span
            key={question.id}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              answers[question.id]
                ? 'bg-[var(--units-orange)]'
                : index === stepIndex
                  ? 'bg-[color-mix(in_srgb,var(--units-orange)_45%,transparent)]'
                  : 'bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]'
            )}
          />
        ))}
      </div>
    </div>
  )
}

/** Large tappable option row — one clear choice per line instead of pill chips. */
function OptionRow({
  label,
  checked,
  disabled,
  onSelect,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[14px] font-medium leading-snug transition-colors duration-150',
        disabled && 'cursor-not-allowed opacity-60',
        checked
          ? 'border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_7%,transparent)] text-foreground'
          : 'border-[var(--units-stroke-color)] bg-background text-foreground hover:border-zinc-400'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
          checked
            ? 'border-[var(--units-orange)] bg-[var(--units-orange)] text-white'
            : 'border-zinc-300 bg-transparent'
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 whitespace-normal break-words">{label}</span>
    </button>
  )
}

/** Single-question screen with auto-advance on selection. */
function QuestionStep({
  question,
  selected,
  disabled,
  isLast,
  onSelect,
  onBack,
  onSkip,
  onQuickFill,
}: {
  question: QuestionnaireQuestion
  selected: string | null | undefined
  disabled: boolean
  isLast: boolean
  onSelect: (option: string) => void
  onBack?: () => void
  onSkip: () => void
  onQuickFill?: () => void
}) {
  return (
    <div key={question.id} className="units-stage-enter flex flex-col gap-4">
      <h3 className="text-[16.5px] font-medium leading-6 text-zinc-800 dark:text-zinc-100">
        {question.title}
      </h3>
      <div
        role="radiogroup"
        aria-label={question.title}
        className="flex flex-col gap-2"
      >
        {question.options.map((option) => (
          <OptionRow
            key={option}
            label={option}
            checked={selected === option}
            disabled={disabled}
            onSelect={() => onSelect(option)}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            className="h-[33px] rounded-full px-3 text-[13px] font-normal text-muted-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            上一题
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {onQuickFill ? (
            <Button
              type="button"
              variant="ghost"
              className="h-[33px] rounded-full px-3 text-[13px] font-normal text-muted-foreground"
              onClick={onQuickFill}
            >
              <CheckCheck className="size-3.5" />
              一键勾选推进
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-[33px] rounded-full px-3 text-[13px] font-normal text-muted-foreground"
            onClick={onSkip}
          >
            {isLast ? '跳过并预览' : '跳过此题'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Final screen: answer recap + what happens next + submit. */
function ReviewStep({
  questions,
  answers,
  isSubmitting,
  canSubmit,
  readOnly,
  onEdit,
  onSubmit,
}: {
  questions: QuestionnaireQuestion[]
  answers: QuestionnaireAnswers
  isSubmitting: boolean
  canSubmit: boolean
  readOnly: boolean
  onEdit: (index: number) => void
  onSubmit?: () => void
}) {
  const answeredCount = questions.filter((q) => answers[q.id]).length

  return (
    <div className="units-stage-enter flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {questions.map((question, index) => {
          const answer = answers[question.id]
          return (
            <li
              key={question.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-[var(--units-stroke-color)] bg-background px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-muted-foreground">
                  {question.title}
                </p>
                <p
                  className={cn(
                    'mt-0.5 text-[14px] font-medium leading-snug',
                    answer ? 'text-foreground' : 'text-muted-foreground/70'
                  )}
                >
                  {answer ?? '已跳过'}
                </p>
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`修改：${question.title}`}
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
                  onClick={() => onEdit(index)}
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {answeredCount === 0 && !readOnly ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          至少回答一个问题，方案才能贴合你的偏好。点右侧铅笔可回到对应问题。
        </p>
      ) : null}

      <section
        aria-label="提交后的流程"
        className="rounded-xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)] px-3.5 py-3"
      >
        <p className="text-[12px] font-semibold text-muted-foreground">
          提交后会发生什么
        </p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {NEXT_STEPS.map((step, index) => (
            <li key={step.key} className="flex items-baseline gap-2">
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--units-orange)]">
                {index + 1}
              </span>
              <p className="min-w-0 text-[12.5px] leading-relaxed text-foreground">
                {step.label}
                <span className="text-muted-foreground"> · {step.detail}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>

      {isSubmitting ? (
        <StageLiveStatus
          hints={SUBMITTING_HINTS}
          note="通常几秒内完成，随后自动进入市场检索"
        />
      ) : null}

      {onSubmit ? (
        <div className="-mx-1 -mb-1 flex justify-end">
          <Button
            type="button"
            disabled={!canSubmit}
            className="h-[38px] rounded-full bg-zinc-950 px-5 text-[14px] font-normal text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            onClick={onSubmit}
          >
            {isSubmitting ? (
              <>
                <Spinner className="size-3.5" />
                提交中…
              </>
            ) : (
              '确认，开始编排方案'
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One-question-at-a-time wizard. Selection auto-advances; the review step
 * recaps answers and previews the downstream flow before submit.
 */
function QuestionnaireWizard({
  questions,
  answers,
  isSubmitting,
  readOnly,
  onAnswerChange,
  onApplyAnswers,
  onSubmitAnswers,
}: {
  questions: QuestionnaireQuestion[]
  answers: QuestionnaireAnswers
  isSubmitting: boolean
  readOnly: boolean
  onAnswerChange?: (questionId: string, option: string) => void
  onApplyAnswers?: (answers: QuestionnaireAnswers) => void
  onSubmitAnswers?: (answers: PolicyIntakeAnswer[]) => void
}) {
  // Read-only viewers (or fully answered reloads) land straight on the recap.
  const [stepIndex, setStepIndex] = useState(() =>
    readOnly || questions.every((q) => answers[q.id])
      ? questions.length
      : questions.findIndex((q) => !answers[q.id])
  )
  const advanceTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (advanceTimer.current != null)
        window.clearTimeout(advanceTimer.current)
    },
    []
  )

  const clampedIndex = Math.max(0, Math.min(stepIndex, questions.length))
  const onReview = clampedIndex >= questions.length
  const question = onReview ? null : questions[clampedIndex]

  const goTo = (index: number) => {
    if (advanceTimer.current != null) window.clearTimeout(advanceTimer.current)
    setStepIndex(Math.max(0, Math.min(index, questions.length)))
  }

  const handleSelect = (option: string) => {
    if (!question) return
    const alreadySelected = answers[question.id] === option
    if (!alreadySelected) onAnswerChange?.(question.id, option)
    // Brief pause so the selection state registers before the screen changes.
    if (advanceTimer.current != null) window.clearTimeout(advanceTimer.current)
    advanceTimer.current = window.setTimeout(
      () => setStepIndex((value) => Math.min(value + 1, questions.length)),
      alreadySelected ? 0 : AUTO_ADVANCE_DELAY_MS
    )
  }

  // One-click fill: default every unanswered question to its first option and
  // jump straight to the review step (existing choices are kept).
  const handleQuickFill = () => {
    const next: QuestionnaireAnswers = { ...answers }
    for (const q of questions) {
      if (!next[q.id] && q.options.length > 0) next[q.id] = q.options[0]
    }
    if (onApplyAnswers) {
      onApplyAnswers(next)
    } else if (onAnswerChange) {
      questions.forEach((q) => {
        if (!answers[q.id] && q.options.length > 0)
          onAnswerChange(q.id, q.options[0])
      })
    }
    goTo(questions.length)
  }

  const canQuickFill =
    !readOnly &&
    !isSubmitting &&
    Boolean(onApplyAnswers ?? onAnswerChange) &&
    questions.some((q) => !answers[q.id] && q.options.length > 0)

  const selectedAnswers = getSelectedAnswers(questions, answers)
  const canSubmit =
    selectedAnswers.length > 0 && Boolean(onSubmitAnswers) && !isSubmitting

  return (
    <div className="mt-4 flex flex-col gap-4">
      <WizardProgress
        questions={questions}
        answers={answers}
        stepIndex={clampedIndex}
      />
      {question ? (
        <QuestionStep
          question={question}
          selected={answers[question.id]}
          disabled={isSubmitting || readOnly}
          isLast={clampedIndex === questions.length - 1}
          onSelect={handleSelect}
          onBack={clampedIndex > 0 ? () => goTo(clampedIndex - 1) : undefined}
          onSkip={() => goTo(clampedIndex + 1)}
          onQuickFill={canQuickFill ? handleQuickFill : undefined}
        />
      ) : (
        <ReviewStep
          questions={questions}
          answers={answers}
          isSubmitting={isSubmitting}
          canSubmit={canSubmit}
          readOnly={readOnly}
          onEdit={goTo}
          onSubmit={
            onSubmitAnswers
              ? () => onSubmitAnswers(selectedAnswers)
              : undefined
          }
        />
      )}
    </div>
  )
}

function QuestionnaireSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4" aria-hidden>
      <div className="flex gap-1">
        {[0, 1, 2].map((cell) => (
          <StageSkeletonBlock
            key={cell}
            className="h-1 flex-1"
            radius="rounded-full"
          />
        ))}
      </div>
      <StageSkeletonBlock className="h-5 w-3/5" radius="rounded-sm" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((option) => (
          <StageSkeletonBlock key={option} className="h-[46px] w-full" />
        ))}
      </div>
    </div>
  )
}

function QuestionnaireCard({
  children,
  initialMessage,
  busy = false,
}: {
  children: ReactNode
  initialMessage?: string
  busy?: boolean
}) {
  return (
    <div className="scrollbar-fade min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full w-full max-w-[55rem] px-6 pb-40">
        <ol className="flex flex-col gap-7 py-5">
          {initialMessage ? (
            <li className="list-none">
              <div className="rounded-2xl border border-[color-mix(in_srgb,var(--units-black)_8%,transparent)] bg-[color-mix(in_srgb,var(--units-black)_4%,transparent)] px-[18px] py-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  保障需求
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
                  {initialMessage}
                </p>
              </div>
            </li>
          ) : null}
          <li className="list-none">
            <div className="flex min-w-0 flex-col gap-4">
              <p className="max-w-[42rem] whitespace-pre-wrap text-[15px] leading-7 text-foreground">
                {QUESTIONNAIRE_WELCOME}
              </p>
              <div
                data-slot="conversation-tool-shell"
                data-stage="questionnaire"
                aria-busy={busy}
                className="flex w-full max-w-[36rem] flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-transparent px-5 py-5"
              >
                <h2 className="text-[19.5px] font-semibold leading-7 tracking-tight text-zinc-900 dark:text-zinc-100">
                  让我们进行一些更深入的了解：
                </h2>
                {children}
              </div>
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}

function GenerateFailedState({
  reason,
  onRetry,
  onUseFallback,
}: {
  reason?: string | null
  onRetry?: () => void
  onUseFallback?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-4 text-destructive" />
        </span>
        <p className="min-w-0 text-sm leading-relaxed text-foreground">
          {reason ??
            '问卷生成服务暂不可用。你可以重试，或使用基础问卷继续。'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {onRetry ? (
          <Button
            type="button"
            className="h-[33px] rounded-full bg-zinc-950 px-3 text-sm font-normal text-white hover:bg-zinc-800"
            onClick={onRetry}
          >
            重试生成
          </Button>
        ) : null}
        {onUseFallback ? (
          <Button
            type="button"
            variant="outline"
            className="h-[33px] rounded-full px-3 text-sm font-normal"
            onClick={onUseFallback}
          >
            使用基础问卷
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export interface NeedsStageProps {
  initialMessage?: string
  questions?: QuestionnaireQuestion[]
  factorCategories?: RiskFactorCategory[]
  answers?: QuestionnaireAnswers
  isSubmittingAnswers?: boolean
  isGeneratingQuestionnaire?: boolean
  stageStatus?: StageStatus
  subagents?: AgentSubagent[]
  onAnswerChange?: (questionId: string, option: string) => void
  onApplyAnswers?: (answers: QuestionnaireAnswers) => void
  onSubmitAnswers?: (answers: PolicyIntakeAnswer[]) => void
  onRetryGenerate?: () => void
  onUseBasicQuestionnaire?: () => void
  errorMessage?: string | null
}

export function NeedsStage({
  initialMessage,
  questions = [],
  answers = {},
  isSubmittingAnswers = false,
  isGeneratingQuestionnaire = false,
  stageStatus = 'idle',
  onAnswerChange,
  onApplyAnswers,
  onSubmitAnswers,
  onRetryGenerate,
  onUseBasicQuestionnaire,
  errorMessage,
}: NeedsStageProps) {
  const isGenerating =
    questions.length === 0 &&
    !errorMessage &&
    (isGeneratingQuestionnaire ||
      stageStatus === 'loading' ||
      stageStatus === 'retry' ||
      stageStatus === 'idle')
  const isGenerateFailed =
    questions.length === 0 &&
    (stageStatus === 'failed' || Boolean(errorMessage))
  const elapsedMs = useElapsedMs(isGenerating)

  if (isGenerating || isGenerateFailed) {
    const failed = isGenerateFailed || elapsedMs >= GENERATE_TIMEOUT_MS
    const canEscape = elapsedMs >= ESCAPE_AFTER_MS

    return (
      <QuestionnaireCard initialMessage={initialMessage} busy={!failed}>
        {failed ? (
          <GenerateFailedState
            reason={isGenerateFailed ? errorMessage : null}
            onRetry={onRetryGenerate}
            onUseFallback={onUseBasicQuestionnaire}
          />
        ) : (
          <>
            <StageLiveStatus
              className="mt-3"
              hints={GENERATING_HINTS}
              note="问题会按你的风险描述定制，通常在 30 秒内就绪"
            />
            <QuestionnaireSkeleton />
            {canEscape && onUseBasicQuestionnaire ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                <p className="min-w-0 text-[13px] text-muted-foreground">
                  等待时间较长，可以先使用基础问卷继续。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-[33px] shrink-0 rounded-full px-3 text-sm font-normal"
                  onClick={onUseBasicQuestionnaire}
                >
                  使用基础问卷
                </Button>
              </div>
            ) : null}
          </>
        )}
      </QuestionnaireCard>
    )
  }

  return (
    <QuestionnaireCard initialMessage={initialMessage}>
      <QuestionnaireWizard
        key={questions.map((q) => q.id).join('|')}
        questions={questions}
        answers={answers}
        isSubmitting={isSubmittingAnswers}
        readOnly={!onAnswerChange}
        onAnswerChange={onAnswerChange}
        onApplyAnswers={onApplyAnswers}
        onSubmitAnswers={onSubmitAnswers}
      />

      {errorMessage ? (
        <p className="mt-3 text-sm text-destructive">{errorMessage}</p>
      ) : null}
    </QuestionnaireCard>
  )
}
