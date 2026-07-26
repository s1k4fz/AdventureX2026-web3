import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Shield } from 'lucide-react'

import type { AgentInputPayload } from '@/components/AgentInput'
import { ConversationInput } from '@/features/conversation/ConversationInput'
import { useCreateAgentTaskMutation } from '@/features/agent/agentApi'
import { NeedsStage } from '@/features/policy-journey/stages/NeedsStage'

const SUGGESTED_PROMPTS = [
  {
    title: '利率路径对冲',
    body: '担心美联储年内降息次数不及预期，想对冲利率路径风险',
  },
  {
    title: '能源地缘风险',
    body: '担心地缘冲突升级影响能源价格，希望用预测市场做保护',
  },
  {
    title: '大选宏观波动',
    body: '想对冲大选结果不确定带来的宏观波动',
  },
]

interface AgentTaskLaunchState {
  agentTaskLaunch?: {
    goalText: string
    displayText?: string
    clientRequestId: string
  }
}

export function AgentTaskNewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [draft, setDraft] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const initialLaunch = (location.state as AgentTaskLaunchState | null)
    ?.agentTaskLaunch
  const [launch, setLaunch] = useState<
    AgentTaskLaunchState['agentTaskLaunch'] | null
  >(initialLaunch ?? null)
  const startedLaunchRef = useRef<string | null>(null)
  const createTask = useCreateAgentTaskMutation()

  const begin = (goalText: string, displayText?: string) => {
    const text = goalText.trim()
    if (!text || createTask.isPending || launch) return
    setErrorMessage(null)
    setLaunch({
      goalText: text,
      displayText: displayText ?? text,
      clientRequestId: crypto.randomUUID(),
    })
  }

  const handleSend = (payload: AgentInputPayload) => {
    begin(payload.content, payload.displayText)
  }

  // The launcher route is also used as an immediate handoff from home. Keep
  // the create mutation here so its successful response pre-populates the
  // task query cache before the live-workbench route mounts.
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
        navigate(`/tasks/${task.id}`, { replace: true })
      })
      .catch(() => {
        setDraft(launch.displayText ?? launch.goalText)
        setLaunch(null)
        setErrorMessage(
          '创建任务失败，请重试。若持续失败，请确认后端已连接且已登录。'
        )
      })
  }, [createTask, launch, navigate])

  if (launch) {
    return (
      <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
        <NeedsStage
          initialMessage={launch.displayText ?? launch.goalText}
          isGeneratingQuestionnaire
          stageStatus="loading"
        />
        <div className="units-workspace-input-dock shrink-0 p-2.5 sm:p-3">
          <div className="mx-auto w-full max-w-2xl">
            <ConversationInput
              value=""
              onValueChange={() => undefined}
              isStreaming
              onSend={() => undefined}
              onStop={() => undefined}
              variant="home"
              modeLabel="保障任务"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="units-conversation-page units-app-panel relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="scrollbar-fade min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-7 sm:px-5">
          <div className="units-stage-enter max-w-xl">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--units-orange)] text-[var(--units-on-accent)]">
              <Shield className="size-5" />
            </span>
            <p className="mt-4 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              xEngine · 保障任务
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-semibold tracking-tight">
              先说清你担心什么
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              问卷、市场检索与三档方案会出现在工作台画布。你直接操作产物，指令栏用来补充偏好。
            </p>
          </div>

          <div className="units-stagger mt-5 flex flex-col gap-2">
            {errorMessage ? (
              <p className="rounded-xl bg-[color-mix(in_srgb,var(--units-red)_10%,transparent)] px-3 py-2 text-sm text-[var(--units-red)]">
                {errorMessage}
              </p>
            ) : null}
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt.body}
                type="button"
                disabled={createTask.isPending}
                onClick={() => begin(prompt.body)}
                className="group flex items-center gap-3 rounded-xl bg-[var(--units-wash-strong)] px-3.5 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--units-black)_7%,transparent)] disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-[var(--units-orange)]">
                    {prompt.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-5">
                    {prompt.body}
                  </span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="units-workspace-input-dock shrink-0 p-2.5 sm:p-3">
        <div className="mx-auto w-full max-w-2xl">
          <ConversationInput
            value={draft}
            onValueChange={setDraft}
            isStreaming={createTask.isPending}
            onSend={handleSend}
            onStop={() => undefined}
            variant="home"
            modeLabel="保障任务"
          />
        </div>
      </div>
    </div>
  )
}
