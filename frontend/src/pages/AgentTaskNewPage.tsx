import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'

import { Spinner } from '@/components/ui/spinner'
import { useCreateAgentTaskMutation } from '@/features/agent/agentApi'
import { PolicyCreateForm } from '@/features/policy-create/PolicyCreateForm'
import { NeedsStage } from '@/features/policy-journey/stages/NeedsStage'

interface AgentTaskLaunchState {
  agentTaskLaunch?: {
    goalText: string
    displayText?: string
    clientRequestId: string
  }
  /** 首页紧凑入口带来的需求描述草稿，预填工作台表单。 */
  draftNeedText?: string
}

/** 创建失败 / 刷新后可恢复的草稿（sessionStorage，会话级）。 */
const DRAFT_STORAGE_KEY = 'xengine.policy-create-draft'

function readStoredDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredDraft(text: string) {
  try {
    if (text.trim()) sessionStorage.setItem(DRAFT_STORAGE_KEY, text)
    else sessionStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // 隐私模式等存储不可用时静默降级，不阻断创建流程。
  }
}

export function AgentTaskNewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const routeState = location.state as AgentTaskLaunchState | null
  const initialLaunch = routeState?.agentTaskLaunch
  const [draftNeedText, setDraftNeedText] = useState(
    () => routeState?.draftNeedText ?? readStoredDraft()
  )
  const [launch, setLaunch] = useState<
    AgentTaskLaunchState['agentTaskLaunch'] | null
  >(initialLaunch ?? null)
  const startedLaunchRef = useRef<string | null>(null)
  // 重试同一目标时复用 clientRequestId，后端幂等不会产生重复任务。
  const failedLaunchRef = useRef<{
    goalText: string
    clientRequestId: string
  } | null>(null)
  const createTask = useCreateAgentTaskMutation()

  const begin = (goalText: string, displayText?: string) => {
    const text = goalText.trim()
    if (!text || createTask.isPending || launch) return
    setErrorMessage(null)
    const reusableId =
      failedLaunchRef.current?.goalText === text
        ? failedLaunchRef.current.clientRequestId
        : crypto.randomUUID()
    setLaunch({
      goalText: text,
      displayText: displayText ?? text,
      clientRequestId: reusableId,
    })
  }

  // Keep the create mutation here so its successful response pre-populates
  // the task query cache before the live-workbench route mounts.
  useEffect(() => {
    if (!launch || startedLaunchRef.current === launch.clientRequestId) return
    startedLaunchRef.current = launch.clientRequestId

    void createTask
      .mutateAsync({
        goalText: launch.goalText,
        title: (launch.displayText ?? launch.goalText).slice(0, 50),
        clientRequestId: launch.clientRequestId,
      })
      .then((task) => {
        failedLaunchRef.current = null
        writeStoredDraft('')
        navigate(`/tasks/${task.id}`, { replace: true })
      })
      .catch(() => {
        failedLaunchRef.current = {
          goalText: launch.goalText,
          clientRequestId: launch.clientRequestId,
        }
        // 允许同一 clientRequestId 再次发起（幂等重试）。
        startedLaunchRef.current = null
        const draft = launch.displayText ?? launch.goalText
        setDraftNeedText(draft)
        writeStoredDraft(draft)
        setLaunch(null)
        setErrorMessage(
          '创建任务失败，请重试。若持续失败，请确认后端已连接且已登录。草稿已保留，刷新页面也不会丢失。'
        )
      })
  }, [createTask, launch, navigate])

  if (launch) {
    return (
      <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-[var(--units-stroke-color)] px-4 py-2.5"
        >
          <Spinner className="size-3.5 text-[var(--units-orange)]" />
          <p className="text-[13px] font-medium text-foreground">
            已提交，正在初始化工作台…
          </p>
          <p className="hidden text-[12px] text-muted-foreground sm:block">
            问卷与市场检索会在工作台画布中推进
          </p>
        </div>
        <NeedsStage
          initialMessage={launch.displayText ?? launch.goalText}
          isGeneratingQuestionnaire
          stageStatus="loading"
        />
      </div>
    )
  }

  return (
    <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="scrollbar-fade min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-5">
          <div className="units-stage-enter max-w-xl">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--units-orange)] text-[var(--units-on-accent)]">
              <Shield className="size-5" />
            </span>
            <p className="mt-4 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              xEngine · 新建保障工作台
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-semibold tracking-tight">
              填写保障需求
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              描述担忧并勾选偏好，创建后工作台会依次推进问卷、市场检索与三档方案。
            </p>
          </div>

          <div className="units-stagger mt-6">
            <PolicyCreateForm
              key={draftNeedText}
              initialNeedText={draftNeedText}
              isSubmitting={createTask.isPending}
              errorMessage={errorMessage}
              onNeedTextChange={writeStoredDraft}
              onSubmit={({ goalText, displayText }) =>
                begin(goalText, displayText)
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
