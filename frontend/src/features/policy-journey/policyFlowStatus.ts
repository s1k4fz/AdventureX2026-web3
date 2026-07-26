import type { AgentTaskStatus } from '@/features/agent/types'

import type { JourneyStage, StageStatus } from './types'

/** Single user-visible flow status — avoids conflicting “等待你 / 思考中 / 检索中”. */
export type PolicyFlowStatusKind =
  | 'awaiting_fill'
  | 'retrieving'
  | 'awaiting_confirm'
  | 'active'
  | 'failed'

export type PolicyFlowStatus = {
  kind: PolicyFlowStatusKind
  label: string
  /** Short next-step hint for the flow rail footer / empty states. */
  nextHint: string
}

export const POLICY_FLOW_STATUS_STYLES: Record<
  PolicyFlowStatusKind,
  { badge: string; dot: string }
> = {
  awaiting_fill: {
    badge:
      'border-[color-mix(in_srgb,#b45309_35%,transparent)] bg-[color-mix(in_srgb,#f59e0b_18%,transparent)] text-[#92400e]',
    dot: 'bg-[#f59e0b]',
  },
  retrieving: {
    badge:
      'border-[color-mix(in_srgb,var(--units-blue)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-blue)_14%,transparent)] text-[var(--units-blue)]',
    dot: 'bg-[var(--units-blue)]',
  },
  awaiting_confirm: {
    badge:
      'border-[color-mix(in_srgb,var(--units-lilac)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-lilac)_16%,transparent)] text-[#6b3fa0]',
    dot: 'bg-[var(--units-lilac)]',
  },
  active: {
    badge:
      'border-[color-mix(in_srgb,var(--units-green)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_14%,transparent)] text-[var(--units-green)]',
    dot: 'bg-[var(--units-green)]',
  },
  failed: {
    badge:
      'border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-destructive',
    dot: 'bg-destructive',
  },
}

export type ResolvePolicyFlowStatusInput = {
  taskStatus?: AgentTaskStatus | null
  currentStage: JourneyStage
  stageStatus: StageStatus
  isGeneratingQuestionnaire?: boolean
  hasQuestions?: boolean
  unansweredCount?: number
  marketItemCount?: number | null
  hasPendingApproval?: boolean
}

export function resolvePolicyFlowStatus(
  input: ResolvePolicyFlowStatusInput
): PolicyFlowStatus {
  const {
    taskStatus,
    currentStage,
    stageStatus,
    isGeneratingQuestionnaire = false,
    hasQuestions = false,
    unansweredCount = 0,
    marketItemCount = null,
    hasPendingApproval = false,
  } = input

  if (taskStatus === 'failed' || stageStatus === 'failed') {
    return {
      kind: 'failed',
      label: '失败需处理',
      nextHint: '请查看原因后重试或调整输入',
    }
  }

  if (taskStatus === 'succeeded' || taskStatus === 'monitoring') {
    return {
      kind: 'active',
      label: taskStatus === 'monitoring' ? '监控中' : '已生效',
      nextHint: '保障已生效，可持续查看监控状态',
    }
  }

  if (taskStatus === 'cancelled') {
    return {
      kind: 'failed',
      label: '已取消',
      nextHint: '任务已取消，无法继续推进',
    }
  }

  // A blocked user outranks background work: the task can be `running` (market
  // collection) while the questionnaire is already waiting to be filled.
  const userActionRequired =
    !isGeneratingQuestionnaire &&
    (hasPendingApproval ||
      stageStatus === 'waiting_confirmation' ||
      taskStatus === 'waiting_user' ||
      (currentStage === 'needs' && hasQuestions))

  if (
    !userActionRequired &&
    (isGeneratingQuestionnaire ||
      stageStatus === 'loading' ||
      stageStatus === 'retry' ||
      taskStatus === 'running')
  ) {
    if (currentStage === 'needs' && isGeneratingQuestionnaire) {
      return {
        kind: 'retrieving',
        label: 'AI 检索中',
        nextHint: '正在根据风险描述生成确认问题',
      }
    }
    if (currentStage === 'market_research') {
      return {
        kind: 'retrieving',
        label: 'AI 检索中',
        nextHint: '正在匹配可用预测市场',
      }
    }
    if (currentStage === 'coverage_plan' || currentStage === 'risk_profile') {
      return {
        kind: 'retrieving',
        label: 'AI 检索中',
        nextHint: '正在生成保障方案',
      }
    }
    return {
      kind: 'retrieving',
      label: 'AI 检索中',
      nextHint: '系统正在处理，请稍候',
    }
  }

  if (
    currentStage === 'market_research' &&
    stageStatus === 'success' &&
    marketItemCount === 0
  ) {
    return {
      kind: 'failed',
      label: '未找到可用市场',
      nextHint: '请调整风险描述或关键词后重试',
    }
  }

  if (userActionRequired) {
    if (currentStage === 'needs' && hasQuestions) {
      return {
        kind: 'awaiting_fill',
        label: '等待填写',
        nextHint:
          unansweredCount > 0
            ? `请完成 ${unansweredCount} 个问题`
            : '问卷已填完，可继续编排方案',
      }
    }
    if (currentStage === 'coverage_plan') {
      return {
        kind: 'awaiting_confirm',
        label: '等待确认',
        nextHint: '请选择保障档位',
      }
    }
    if (currentStage === 'on_chain_active') {
      return {
        kind: 'awaiting_confirm',
        label: '等待出资',
        nextHint: '连接钱包 → 设置保费 → 授权 USDC（approve）→ 开保并锁定保费',
      }
    }
    return {
      kind: 'awaiting_confirm',
      label: '等待确认',
      nextHint: '请完成当前步骤的确认操作',
    }
  }

  return {
    kind: 'retrieving',
    label: '进行中',
    nextHint: '流程推进中',
  }
}
