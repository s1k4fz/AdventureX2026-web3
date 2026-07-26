import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  useSubmitAgentApprovalMutation,
} from '../agentApi'
import type { ArtifactViewProps } from '../artifactRegistry'
import { usePendingApproval } from '../approvalUtils'
import { canSubmitApprovals } from '../taskCapabilities'
import {
  mapPolicyToView,
  usePolicyQuery,
  usePolicyQuestionnaireQuery,
  type PolicyIntakeAnswer,
  type QuestionnaireAnswers,
  type QuestionnaireQuestion,
} from '@/features/policy/policyApi'
import {
  PolicyJourneyShell,
  selectionErrorMessage,
} from '@/features/policy-journey/PolicyJourneyShell'
import { usePolicyJourneyState } from '@/features/policy-journey/usePolicyJourneyState'

const BASIC_QUESTIONNAIRE: QuestionnaireQuestion[] = [
  {
    id: 'basic-horizon',
    title: '你更关注多长时间内的风险变化？',
    options: ['1 个月内', '1–3 个月', '3–12 个月', '一年以上'],
  },
  {
    id: 'basic-priority',
    title: '保障目标更偏向哪一类？',
    options: ['控制回撤', '平衡保费与赔付', '提高赔付弹性'],
  },
  {
    id: 'basic-budget',
    title: '可接受的保费负担大概是？',
    options: ['尽量低', '中等', '可为更高赔付加码'],
  },
  {
    id: 'basic-tolerance',
    title: '对短期波动的容忍度？',
    options: ['较低', '中等', '较高'],
  },
]

export function PolicyJourneyArtifact({
  task,
  policyId,
}: ArtifactViewProps) {
  const navigate = useNavigate()
  const { journey } = usePolicyJourneyState(task.id, policyId)

  const writable = canSubmitApprovals(task.status)
  const intakeApproval = usePendingApproval(task, 'intake_answers')
  const portfolioApproval = usePendingApproval(task, 'select_portfolio')
  const approval = writable ? intakeApproval : undefined
  const portfolioWritable = writable && Boolean(portfolioApproval)

  const policyQuery = usePolicyQuery(policyId ?? undefined, {
    pollSettled: true,
  })
  const view = policyQuery.data ? mapPolicyToView(policyQuery.data) : null
  const questionnaireReady = policyQuery.data?.questionnaireReady ?? false

  const questionnaireQuery = usePolicyQuestionnaireQuery(policyId ?? undefined, {
    enabled: Boolean(policyId) && questionnaireReady,
  })

  const pendingApproval = task.approvals.find(
    (item) => item.kind === 'intake_answers' && item.status === 'pending'
  )
  const intakeRecord =
    pendingApproval ??
    task.approvals.find((item) => item.kind === 'intake_answers')
  const payloadQuestions =
    (
      intakeRecord?.payload?.questionnaire as
        | { questions?: Array<{ id: string; title: string; options: string[] }> }
        | undefined
    )?.questions ?? []

  const [fallbackQuestions, setFallbackQuestions] = useState<
    QuestionnaireQuestion[] | null
  >(null)

  const questions =
    fallbackQuestions ??
    questionnaireQuery.data?.questions ??
    payloadQuestions ??
    []

  const factorCategories =
    questionnaireQuery.data?.factorCategories ??
    (
      intakeRecord?.payload?.questionnaire as
        | { factorCategories?: Array<{ id: string; label: string; rationale?: string }> }
        | undefined
    )?.factorCategories ??
    policyQuery.data?.factorCategories ??
    []

  const [answers, setAnswers] = useState<QuestionnaireAnswers>({})
  const submit = useSubmitAgentApprovalMutation()

  const onSubmitAnswers = (selected: PolicyIntakeAnswer[]) => {
    if (!writable || !approval) return
    submit.mutate({
      taskId: task.id,
      approvalId: approval.id,
      version: approval.version,
      clientRequestId: crypto.randomUUID(),
      response: { answers: selected },
    })
  }

  const onSelectPortfolio = (portfolioId: string) => {
    if (!portfolioWritable || !portfolioApproval) {
      if (policyId) navigate(`/policy/${policyId}`)
      return
    }
    submit.mutate({
      taskId: task.id,
      approvalId: portfolioApproval.id,
      version: portfolioApproval.version,
      clientRequestId: crypto.randomUUID(),
      response: { portfolioId },
    })
  }

  const selectedPortfolioId = useMemo(() => {
    const submitted = task.approvals.find(
      (item) =>
        item.kind === 'select_portfolio' && item.status === 'submitted'
    )
    const response = submitted?.response as { portfolioId?: string } | undefined
    if (response?.portfolioId) return response.portfolioId
    // Live SSE may create confirm_funding before the select response is
    // hydrated; the funding approval payload still carries the locked tier.
    const funding = task.approvals.find(
      (item) =>
        item.kind === 'confirm_funding' &&
        (item.status === 'pending' || item.status === 'submitted')
    )
    const payload = funding?.payload as { portfolioId?: string } | undefined
    return payload?.portfolioId ?? null
  }, [task.approvals])

  const submitError = submit.isError
    ? portfolioWritable
      ? selectionErrorMessage(submit.error)
      : '提交问卷失败，请重试'
    : null

  return (
    <PolicyJourneyShell
      fillHeight
      title={view?.title ?? task.title}
      initialMessage={task.goalText}
      journey={journey}
      taskId={task.id}
      taskStatus={task.status}
      questions={questions}
      factorCategories={factorCategories}
      answers={answers}
      isSubmittingAnswers={submit.isPending}
      isGeneratingQuestionnaire={
        !fallbackQuestions && !questionnaireReady && questions.length === 0
      }
      errorMessage={
        submitError ??
        (policyQuery.isError ? '加载保单失败，请重试' : task.errorMessage)
      }
      onAnswerChange={
        writable
          ? (questionId, option) =>
              setAnswers((current) => ({
                ...current,
                [questionId]: current[questionId] === option ? null : option,
              }))
          : undefined
      }
      onApplyAnswers={writable ? setAnswers : undefined}
      onSubmitAnswers={writable && approval ? onSubmitAnswers : undefined}
      onRetryGenerate={() => {
        setFallbackQuestions(null)
        void policyQuery.refetch()
        void questionnaireQuery.refetch()
      }}
      onUseBasicQuestionnaire={() => {
        setFallbackQuestions(BASIC_QUESTIONNAIRE)
        setAnswers({})
      }}
      onSelectPortfolio={
        portfolioWritable || Boolean(policyId) ? onSelectPortfolio : undefined
      }
      selecting={submit.isPending}
      selectedPortfolioId={selectedPortfolioId}
      onEnterPolicy={() => {
        if (policyId) navigate(`/policy/${policyId}`)
      }}
    />
  )
}
