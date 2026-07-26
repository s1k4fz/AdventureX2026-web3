import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'

import type { AgentTaskStatus } from '@/features/agent/types'
import type {
  PolicyIntakeAnswer,
  QuestionnaireAnswers,
  QuestionnaireQuestion,
  RiskFactorCategory,
} from '@/features/policy/policyApi'
import { cn } from '@/lib/utils'

import { JourneyLayout } from './components/JourneyLayout'
import { RederiveOverlay } from './components/RederiveOverlay'
import { useOverrideFlow } from './hooks/useOverrideFlow'
import { JourneyStageCanvas } from './JourneyStageCanvas'
import type { PolicyJourneyState } from './types'

export type PolicyJourneyShellProps = {
  title: string
  initialMessage?: string
  journey: PolicyJourneyState
  questions?: QuestionnaireQuestion[]
  factorCategories?: RiskFactorCategory[]
  answers?: QuestionnaireAnswers
  isSubmittingAnswers?: boolean
  isGeneratingQuestionnaire?: boolean
  onAnswerChange?: (questionId: string, option: string) => void
  onApplyAnswers?: (answers: QuestionnaireAnswers) => void
  onSubmitAnswers?: (answers: PolicyIntakeAnswer[]) => void
  onSelectPortfolio?: (portfolioId: string) => void
  onRetryGenerate?: () => void
  onUseBasicQuestionnaire?: () => void
  selecting?: boolean
  onEnterPolicy?: () => void
  taskId?: string
  errorMessage?: string | null
  taskStatus?: AgentTaskStatus
  selectedPortfolioId?: string | null
  /** Fill the parent workbench height and scroll inside the canvas. */
  fillHeight?: boolean
  className?: string
}

export function PolicyJourneyShell({
  title,
  initialMessage,
  journey,
  questions,
  factorCategories,
  answers,
  isSubmittingAnswers,
  isGeneratingQuestionnaire,
  onAnswerChange,
  onApplyAnswers,
  onSubmitAnswers,
  onSelectPortfolio,
  onRetryGenerate,
  onUseBasicQuestionnaire,
  selecting,
  onEnterPolicy,
  taskId,
  errorMessage,
  taskStatus,
  selectedPortfolioId,
  fillHeight = false,
  className,
}: PolicyJourneyShellProps) {
  const navigate = useNavigate()

  const override = useOverrideFlow({
    taskId,
    isOverriding: journey.isOverriding,
  })

  const canvasContext = useMemo(
    () => ({
      title,
      initialMessage,
      journey,
      questions,
      factorCategories,
      answers,
      isSubmittingAnswers,
      isGeneratingQuestionnaire,
      onAnswerChange,
      onApplyAnswers,
      onSubmitAnswers,
      onSelectPortfolio,
      onRetryGenerate,
      onUseBasicQuestionnaire,
      selecting,
      onEnterPolicy:
        onEnterPolicy ??
        (journey.policyId
          ? () => navigate(`/policy/${journey.policyId}`)
          : undefined),
      taskId,
      taskStatus,
      errorMessage,
      selectedPortfolioId,
    }),
    [
      title,
      initialMessage,
      journey,
      questions,
      factorCategories,
      answers,
      isSubmittingAnswers,
      isGeneratingQuestionnaire,
      onAnswerChange,
      onApplyAnswers,
      onSubmitAnswers,
      onSelectPortfolio,
      onRetryGenerate,
      onUseBasicQuestionnaire,
      selecting,
      onEnterPolicy,
      navigate,
      taskId,
      taskStatus,
      errorMessage,
      selectedPortfolioId,
    ]
  )

  return (
    <div
      data-slot="policy-journey-shell"
      translate="no"
      className={cn(
        'units-policy-core mx-auto flex min-h-0 w-full max-w-[80rem] flex-col',
        fillHeight && 'h-full overflow-hidden',
        className
      )}
    >
      <JourneyLayout
        fillHeight={fillHeight}
        canvas={
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col',
                fillHeight && 'overflow-hidden'
              )}
            >
              <JourneyStageCanvas
                currentStage={journey.currentStage}
                context={canvasContext}
              />
            </div>

            {(journey.isOverriding || override.timedOut) && (
              <RederiveOverlay timeoutError={override.timedOut} />
            )}
          </div>
        }
      />
    </div>
  )
}

export function selectionErrorMessage(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 409) {
    return '方案状态刚刚变化，已不再可选择。请等待任务同步后重试。'
  }
  if (isAxiosError(error) && error.response?.status === 401) {
    return '登录状态已失效，请重新登录后再选择方案。'
  }
  return '选择档位失败，请检查当前方案后重试。'
}
