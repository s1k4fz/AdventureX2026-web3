import type { AgentTaskStatus } from '@/features/agent/types'
import type {
  PolicyIntakeAnswer,
  QuestionnaireAnswers,
  QuestionnaireQuestion,
  RiskFactorCategory,
} from '@/features/policy/policyApi'

import type { JourneyStage, PolicyJourneyState } from './types'
import { CoveragePlanStage } from './stages/CoveragePlanStage'
import { MarketResearchStage } from './stages/MarketResearchStage'
import { NeedsStage } from './stages/NeedsStage'
import { OnChainActiveStage } from './stages/OnChainActiveStage'
import { RiskProfileStage } from './stages/RiskProfileStage'

export interface JourneyStageCanvasContext {
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
  taskStatus?: AgentTaskStatus
  errorMessage?: string | null
  selectedPortfolioId?: string | null
}

export interface JourneyStageCanvasProps {
  currentStage: JourneyStage
  /** Read-only review of a past stage: keep the stage renderer instead of
   * forcing the terminal-state screen. */
  reviewing?: boolean
  context: JourneyStageCanvasContext
}

export function JourneyStageCanvas({
  currentStage,
  reviewing = false,
  context,
}: JourneyStageCanvasProps) {
  const {
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
    taskStatus,
    errorMessage,
    selectedPortfolioId,
  } = context

  const stageStatus = journey.stages[currentStage]
  const portfolios = journey.portfolios as unknown as import('@/features/policy/policyApi').PortfolioOut[]
  const policyId = journey.policyId
  const search = journey.search as import('@/features/policy/streamPolicyCompose').MarketSearchProgress | null

  if (
    !reviewing &&
    taskStatus &&
    (taskStatus === 'cancelled' || taskStatus === 'succeeded')
  ) {
    return (
      <OnChainActiveStage
        title={title}
        taskStatus={taskStatus}
        taskId={taskId}
        policyId={policyId}
        portfolios={portfolios}
        selectedPortfolioId={selectedPortfolioId}
        stageStatus={stageStatus}
        errorMessage={errorMessage}
        onEnterPolicy={onEnterPolicy}
      />
    )
  }

  switch (currentStage) {
    case 'needs':
      return (
        <NeedsStage
          initialMessage={initialMessage}
          questions={questions}
          factorCategories={factorCategories}
          answers={answers}
          isSubmittingAnswers={isSubmittingAnswers}
          isGeneratingQuestionnaire={isGeneratingQuestionnaire}
          stageStatus={stageStatus}
          subagents={journey.subagents}
          onAnswerChange={onAnswerChange}
          onApplyAnswers={onApplyAnswers}
          onSubmitAnswers={onSubmitAnswers}
          onRetryGenerate={onRetryGenerate}
          onUseBasicQuestionnaire={onUseBasicQuestionnaire}
          errorMessage={errorMessage}
        />
      )
    case 'risk_profile':
      return (
        <RiskProfileStage
          factorCategories={factorCategories}
          stageStatus={stageStatus}
          errorMessage={errorMessage}
        />
      )
    case 'market_research':
      return (
        <MarketResearchStage
          title={title}
          search={search}
          subagents={journey.subagents}
          latestExplanation={journey.latestExplanation}
          stageStatus={stageStatus}
          errorMessage={errorMessage}
          taskId={taskId}
        />
      )
    case 'coverage_plan':
      return (
        <CoveragePlanStage
          title={title}
          portfolios={portfolios}
          policyId={policyId ?? undefined}
          factorCategories={factorCategories}
          onSelectPortfolio={onSelectPortfolio}
          selecting={selecting}
          stageStatus={stageStatus}
          errorMessage={errorMessage}
          onEnterPolicy={onEnterPolicy}
          taskId={taskId}
          latestExplanation={journey.latestExplanation}
          selectedPortfolioId={selectedPortfolioId}
        />
      )
    case 'on_chain_active':
      return (
        <OnChainActiveStage
          title={title}
          taskStatus={taskStatus}
          taskId={taskId}
          policyId={policyId}
          portfolios={portfolios}
          selectedPortfolioId={selectedPortfolioId}
          stageStatus={stageStatus}
          errorMessage={errorMessage}
          onEnterPolicy={onEnterPolicy}
        />
      )
    default:
      return null
  }
}
