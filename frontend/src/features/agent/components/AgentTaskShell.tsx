import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AnimatePresence, motion, useUnitsMotion } from '@/lib/motion'
import { AgentTeamStrip } from '@/features/policy-journey/components/AgentTeamStrip'
import { JourneyTrack } from '@/features/policy-journey/components/JourneyTrack'
import { StageGuideBar } from '@/features/policy-journey/components/StageGuideBar'
import {
  PolicyJourneyProvider,
  usePolicyJourneyContext,
} from '@/features/policy-journey/journeyContext'
import { resolvePolicyFlowStatus } from '@/features/policy-journey/policyFlowStatus'
import {
  JOURNEY_STAGES_ORDERED,
  STAGE_LABELS,
  type JourneyStage,
} from '@/features/policy-journey/types'

import { canSendFreeText } from '../taskCapabilities'
import type { AgentActivityItem, AgentTaskDetail } from '../types'
import { AgentCanvas } from './AgentCanvas'
import {
  ConnectionBanner,
  type AgentConnectionState,
} from './ConnectionBanner'
import { TaskAdjustPanel, TaskStatusBanner } from './TaskAdjustPanel'

export interface AgentTaskShellProps {
  task: AgentTaskDetail
  activities: AgentActivityItem[]
  activeViewId?: string | null
  onSelectView?: (id: string) => void
  connectionState?: AgentConnectionState
}

export function AgentTaskShell(props: AgentTaskShellProps) {
  const policyId =
    props.task.primaryRefType === 'policy'
      ? (props.task.primaryRefId ?? null)
      : null
  return (
    <PolicyJourneyProvider taskId={props.task.id} policyId={policyId}>
      <AgentTaskShellInner {...props} />
    </PolicyJourneyProvider>
  )
}

function AgentTaskShellInner({
  task,
  activities,
  activeViewId,
  onSelectView,
  connectionState = 'live',
}: AgentTaskShellProps) {
  const journeyCtx = usePolicyJourneyContext()
  const { soft, reduce } = useUnitsMotion()
  const [adjustRequest, setAdjustRequest] = useState<{
    text: string
    nonce: number
  } | null>(null)

  const journey = journeyCtx?.journey ?? null
  const currentStage = journey?.currentStage ?? 'needs'
  const reviewStage = journeyCtx?.focusedStage ?? null
  const displayStage = reviewStage ?? currentStage

  const hasPendingApproval = task.approvals.some(
    (approval) => approval.status === 'pending'
  )

  // 开单（链上出资）完成后禁用一切「提出修改意见」入口：
  // 任务终态由 canSendFreeText 覆盖，SSE 未追上时由阶段成功态兜底。
  const adjustEnabled =
    canSendFreeText(task.status) &&
    journey?.stages.on_chain_active !== 'success'

  // 多标签页可辨：标题同步「(N/5 阶段名) 任务标题」。
  useEffect(() => {
    const previous = document.title
    const index = JOURNEY_STAGES_ORDERED.indexOf(currentStage)
    document.title = `(${index + 1}/${JOURNEY_STAGES_ORDERED.length} ${STAGE_LABELS[currentStage]}) ${task.title} · xEngine`
    return () => {
      document.title = previous
    }
  }, [currentStage, task.title])

  const flowStatus = useMemo(() => {
    if (!journey) return null
    return resolvePolicyFlowStatus({
      taskStatus: task.status,
      currentStage: journey.currentStage,
      stageStatus: journey.stages[journey.currentStage],
      hasPendingApproval,
      marketItemCount: journey.search?.totalCount ?? null,
    })
  }, [journey, task.status, hasPendingApproval])

  // 采集情报步骤下的紧凑进度提示（画布内已有头像，轨道只给数字）。
  const collectHint = useMemo(() => {
    if (!journey || journey.currentStage !== 'market_research') return null
    const total = journey.subagents.length
    if (total === 0) return null
    const done = journey.subagents.filter(
      (row) =>
        row.status === 'succeeded' ||
        row.status === 'failed' ||
        row.status === 'skipped'
    ).length
    return done >= total ? `采集完成 · ${done}/${total}` : `采集中 · ${done}/${total}`
  }, [journey])

  const handleSelectStage = (stage: JourneyStage) => {
    journeyCtx?.setFocusedStage(stage === currentStage ? null : stage)
  }

  const handleAdjustFromStage = (stage: JourneyStage) => {
    setAdjustRequest({
      text: `关于「${STAGE_LABELS[stage]}」阶段的调整：`,
      nonce: Date.now(),
    })
  }

  // 指引条右侧的调整入口：不预填文案，直接打开面板。
  const handleOpenAdjust = () => {
    setAdjustRequest({ text: '', nonce: Date.now() })
  }

  const track = (className?: string) =>
    journey ? (
      <JourneyTrack
        currentStage={journey.currentStage}
        viewStage={displayStage}
        stages={journey.stages}
        onSelectStage={handleSelectStage}
        flowStatus={flowStatus}
        collectHint={collectHint}
        className={className}
      />
    ) : null

  return (
    <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
      <AnimatePresence initial={false}>
        {connectionState !== 'live' ? (
          <motion.div
            key="connection-banner"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? undefined : { opacity: 0, height: 0 }}
            transition={soft}
            className="shrink-0 overflow-hidden"
          >
            <ConnectionBanner state={connectionState} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <TaskStatusBanner task={task} />
      <div className="flex min-h-0 flex-1">
        {/* 桌面左轨：保障流程 + 常驻 Agent 团队（≥lg） */}
        {journey ? (
          <div className="hidden w-60 shrink-0 lg:flex lg:min-h-0 lg:flex-col lg:border-e lg:border-[var(--units-stroke-color)] lg:bg-[color-mix(in_srgb,var(--units-soft)_55%,transparent)]">
            <div className="min-h-0 flex-1">{track('lg:border-e-0')}</div>
            <AgentTeamStrip
              subagents={journey.subagents}
              compact
              className="m-2 shrink-0"
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 平板横条 / 移动点条（<lg），JourneyTrack 内部按断点切换形态 */}
          {journey ? <div className="shrink-0 lg:hidden">{track()}</div> : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`guide-${displayStage}-${reviewStage ? 'review' : 'live'}`}
              initial={reduce ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: 4 }}
              transition={soft}
              className="shrink-0"
            >
              <StageGuideBar
                stage={displayStage}
                waitingUser={!reviewStage && task.status === 'waiting_user'}
                reviewing={Boolean(reviewStage)}
                onExitReview={() => journeyCtx?.setFocusedStage(null)}
                onAdjustFromStage={
                  adjustEnabled ? handleAdjustFromStage : undefined
                }
                trailing={
                  adjustEnabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={handleOpenAdjust}
                      className="h-7 gap-1 rounded-full border-[var(--units-stroke-color)] px-2.5 text-[12px] shadow-none hover:border-[var(--units-stroke-strong)]"
                    >
                      <SlidersHorizontal className="size-3" />
                      调整需求
                    </Button>
                  ) : null
                }
              />
            </motion.div>
          </AnimatePresence>
          <AgentCanvas
            task={task}
            activeViewId={activeViewId}
            onSelectView={onSelectView}
            activities={activities}
            className="min-h-0 flex-1"
            compactChrome
          />
        </div>
      </div>
      {adjustEnabled ? (
        <TaskAdjustPanel task={task} openRequest={adjustRequest} hideTrigger />
      ) : null}
    </div>
  )
}
