import { useState } from 'react'

import {
  mapPolicyToView,
  usePolicyComposeStream,
  usePolicyQuery,
  usePolicyQuestionnaireQuery,
  useSubmitPolicyIntakeMutation,
  type PolicyIntakeAnswer,
  type PolicyPlannerStage,
  type PortfolioOut,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
  type RiskFactorCategory,
} from './policyApi'
import type { MarketSearchProgress } from './streamPolicyCompose'

export interface PolicyPlannerView {
  stage: PolicyPlannerStage | undefined
  title: string
  questions: QuestionnaireQuestion[]
  factorCategories: RiskFactorCategory[]
  answers: QuestionnaireAnswers
  portfolios: PortfolioOut[]
  search: MarketSearchProgress | null
  reasoningText: string
  errorMessage: string | null
  isSubmittingAnswers: boolean
  /** Intake AI still producing questionnaire (poll until ready). */
  isGeneratingQuestionnaire: boolean
  onAnswerChange: (questionId: string, option: string) => void
  onApplyAnswers: (answers: QuestionnaireAnswers) => void
  onSubmitAnswers: (answers: PolicyIntakeAnswer[]) => void
}

/**
 * Single source of behaviour for the policy-planning tool card, driven by a
 * policyId. Both the in-conversation card and the standalone page use it.
 *
 *   GET /policies/{id}              -> stage / title / portfolios
 *   GET /policies/{id}/questionnaire (only at the questionnaire stage)
 *   POST /intake                    -> compose starts in the worker
 *   Agent Task events (by-policy)   -> live compose progress (search/reasoning)
 */
export function usePolicyPlanner(policyId: string | undefined): PolicyPlannerView {
  const policyQuery = usePolicyQuery(policyId, { enabled: Boolean(policyId) })
  const viewData = policyQuery.data ? mapPolicyToView(policyQuery.data) : null
  const stage = viewData?.stage
  const questionnaireReady = policyQuery.data?.questionnaireReady ?? false

  const questionnaireQuery = usePolicyQuestionnaireQuery(policyId, {
    enabled:
      Boolean(policyId) && stage === 'questionnaire' && questionnaireReady,
  })
  const questions = questionnaireQuery.data?.questions ?? []
  const factorCategories =
    questionnaireQuery.data?.factorCategories ??
    policyQuery.data?.factorCategories ??
    []

  const [answers, setAnswers] = useState<QuestionnaireAnswers>({})

  const submitIntake = useSubmitPolicyIntakeMutation()

  // Live compose SSE: market hits + reasoning -> proposed
  const compose = usePolicyComposeStream(policyId, {
    enabled: stage === 'searching',
  })

  const onAnswerChange = (questionId: string, option: string) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: current[questionId] === option ? null : option,
    }))
  }

  const onApplyAnswers = (next: QuestionnaireAnswers) => {
    setAnswers(next)
  }

  const onSubmitAnswers = (selected: PolicyIntakeAnswer[]) => {
    if (policyId && selected.length > 0) {
      submitIntake.mutate({ policyId, answers: selected })
    }
  }

  const errorMessage = submitIntake.isError
    ? '提交问卷失败，请重试'
    : policyQuery.isError
      ? '加载保单失败，请重试'
      : null

  return {
    stage,
    title: viewData?.title ?? '保障方案规划',
    questions,
    factorCategories,
    answers,
    portfolios: viewData?.portfolios ?? [],
    search: compose.search,
    reasoningText: compose.reasoningText,
    errorMessage,
    isSubmittingAnswers: submitIntake.isPending,
    isGeneratingQuestionnaire:
      stage === 'questionnaire' && !questionnaireReady,
    onAnswerChange,
    onApplyAnswers,
    onSubmitAnswers,
  }
}
