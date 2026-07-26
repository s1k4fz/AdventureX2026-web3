import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/apiClient'
import { retryUnlessClientError, signOutOn401 } from '@/lib/apiUtils'
import { agentDebug, agentDebugWarn } from './agentDebug'
import {
  applyAgentEvent,
  createViewStateFromDetail,
} from './eventReducer'
import {
  AgentEventStreamError,
  streamAgentEvents,
} from './streamAgentEvents'
import type {
  AgentApproval,
  AgentConnectionState,
  AgentTaskDetail,
  AgentTaskListItem,
  AgentTaskViewState,
} from './types'

export const agentTasksQueryRootKey = ['agent-tasks'] as const

export function agentTasksListQueryKey() {
  return [...agentTasksQueryRootKey, 'list'] as const
}

export function agentTaskQueryKey(taskId: string) {
  return [...agentTasksQueryRootKey, 'detail', taskId] as const
}

export async function listAgentTasks(): Promise<AgentTaskListItem[]> {
  const { data } = await signOutOn401(
    apiClient.get<AgentTaskListItem[]>('/api/v1/agent-tasks')
  )
  return data
}

export async function updateAgentTask(variables: {
  taskId: string
  title?: string
  archived?: boolean
}): Promise<AgentTaskListItem> {
  const body: { title?: string; archived?: boolean } = {}
  if (variables.title !== undefined) body.title = variables.title
  if (variables.archived !== undefined) body.archived = variables.archived
  const { data } = await signOutOn401(
    apiClient.patch<AgentTaskListItem>(
      `/api/v1/agent-tasks/${variables.taskId}`,
      body
    )
  )
  return data
}

export async function getAgentTask(taskId: string): Promise<AgentTaskDetail> {
  const { data } = await signOutOn401(
    apiClient.get<AgentTaskDetail>(`/api/v1/agent-tasks/${taskId}`)
  )
  return data
}

export async function getAgentTaskByPolicy(
  policyId: string
): Promise<AgentTaskDetail> {
  const { data } = await signOutOn401(
    apiClient.get<AgentTaskDetail>(
      `/api/v1/agent-tasks/by-policy/${policyId}`
    )
  )
  return data
}

export async function createAgentTask(variables: {
  goalText: string
  title?: string
  clientRequestId?: string
}): Promise<AgentTaskDetail> {
  agentDebug('create task', {
    goalText: variables.goalText.slice(0, 120),
    clientRequestId: variables.clientRequestId,
  })
  const { data } = await signOutOn401(
    apiClient.post<AgentTaskDetail>('/api/v1/agent-tasks', {
      kind: 'policy_planning',
      goalText: variables.goalText,
      title: variables.title,
      clientRequestId: variables.clientRequestId,
    })
  )
  agentDebug('create task ok', {
    taskId: data.id,
    status: data.status,
    policyId: data.primaryRefId,
  })
  return data
}

export async function submitAgentApproval(variables: {
  taskId: string
  approvalId: string
  version: number
  response: Record<string, unknown>
  clientRequestId?: string
}): Promise<AgentTaskDetail> {
  agentDebug('submit approval', {
    taskId: variables.taskId,
    approvalId: variables.approvalId,
    version: variables.version,
    responseKeys: Object.keys(variables.response),
  })
  const { data } = await signOutOn401(
    apiClient.post<AgentTaskDetail>(
      `/api/v1/agent-tasks/${variables.taskId}/approvals/${variables.approvalId}/submit`,
      {
        version: variables.version,
        response: variables.response,
        clientRequestId: variables.clientRequestId,
      }
    )
  )
  agentDebug('submit approval ok', {
    taskId: data.id,
    status: data.status,
  })
  return data
}

export async function postAgentCommand(variables: {
  taskId: string
  type: 'free_text' | 'revise_goal' | 'retry' | 'cancel'
  text?: string
  clientRequestId?: string
}): Promise<AgentTaskDetail> {
  agentDebug('command', {
    taskId: variables.taskId,
    type: variables.type,
    text: variables.text?.slice(0, 120),
  })
  const { data } = await signOutOn401(
    apiClient.post<AgentTaskDetail>(
      `/api/v1/agent-tasks/${variables.taskId}/commands`,
      {
        type: variables.type,
        text: variables.text,
        clientRequestId: variables.clientRequestId,
      }
    )
  )
  agentDebug('command ok', {
    taskId: data.id,
    status: data.status,
    inputRevision: data.inputRevision,
  })
  return data
}

export function useAgentTasksQuery(options?: {
  enabled?: boolean
  refetchInterval?: number | false
}) {
  return useQuery({
    queryKey: agentTasksListQueryKey(),
    queryFn: listAgentTasks,
    enabled: options?.enabled ?? true,
    retry: retryUnlessClientError,
    refetchInterval: options?.refetchInterval,
  })
}

export function useAgentTaskQuery(
  taskId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: agentTaskQueryKey(taskId ?? 'none'),
    queryFn: () => getAgentTask(taskId as string),
    enabled: Boolean(taskId) && (options?.enabled ?? true),
    retry: retryUnlessClientError,
  })
}

export function useCreateAgentTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createAgentTask,
    onSuccess: (task) => {
      queryClient.setQueryData(agentTaskQueryKey(task.id), task)
      void queryClient.invalidateQueries({ queryKey: agentTasksListQueryKey() })
    },
  })
}

export function useUpdateAgentTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateAgentTask,
    onSuccess: (task, variables) => {
      if (variables.archived) {
        queryClient.removeQueries({ queryKey: agentTaskQueryKey(task.id) })
      } else {
        queryClient.setQueryData(agentTaskQueryKey(task.id), (current) =>
          current && typeof current === 'object'
            ? { ...current, ...task }
            : current
        )
      }
      void queryClient.invalidateQueries({ queryKey: agentTasksListQueryKey() })
    },
  })
}

export function useSubmitAgentApprovalMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitAgentApproval,
    onSuccess: (task) => {
      queryClient.setQueryData(agentTaskQueryKey(task.id), task)
      void queryClient.invalidateQueries({ queryKey: agentTasksListQueryKey() })
    },
  })
}

export function useAgentCommandMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: postAgentCommand,
    onSuccess: (task) => {
      queryClient.setQueryData(agentTaskQueryKey(task.id), task)
      void queryClient.invalidateQueries({ queryKey: agentTasksListQueryKey() })
    },
  })
}

/** Statuses that need a cancel command before archiving in bulk close. */
const BULK_CLOSE_CANCEL_STATUSES: AgentTaskListItem['status'][] = [
  'draft',
  'running',
  'waiting_user',
]

async function closeAgentTask(task: AgentTaskListItem): Promise<void> {
  if (BULK_CLOSE_CANCEL_STATUSES.includes(task.status)) {
    try {
      await postAgentCommand({ taskId: task.id, type: 'cancel' })
    } catch (error) {
      // The task may already be terminal (race with backend); archiving below
      // is what actually removes it from the sidebar.
      agentDebugWarn('bulk close: cancel failed, archiving anyway', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  await updateAgentTask({ taskId: task.id, archived: true })
}

export interface BulkCloseAgentTasksResult {
  closed: number
  failed: number
}

/** Cancel (when active) + archive a batch of tasks, e.g. all failed/waiting. */
export function useBulkCloseAgentTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      tasks: AgentTaskListItem[]
    ): Promise<BulkCloseAgentTasksResult> => {
      const results = await Promise.allSettled(tasks.map(closeAgentTask))
      const closed = results.filter((r) => r.status === 'fulfilled').length
      return { closed, failed: results.length - closed }
    },
    onSettled: (result, _error, tasks) => {
      if (result) {
        for (const task of tasks) {
          queryClient.removeQueries({ queryKey: agentTaskQueryKey(task.id) })
        }
      }
      void queryClient.invalidateQueries({ queryKey: agentTasksListQueryKey() })
    },
  })
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isFatalStreamError(error: unknown) {
  if (!(error instanceof AgentEventStreamError)) return false
  if (error.code === 'invalid_token') return true

  const status = /^http_(\d{3})$/.exec(error.code)?.[1]
  if (!status) return false
  // A client-side request error will not recover by reconnecting. Keep the
  // usual retry path for timeout and rate-limit responses, which can recover.
  return status.startsWith('4') && status !== '408' && status !== '429'
}

function waitForStreamReconnect(signal: AbortSignal, delayMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stream aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Stream aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Live task view: snapshot + durable event stream with cursor reconnect. */
export function useAgentTaskLive(taskId: string | undefined): {
  view: AgentTaskViewState | null
  isLoading: boolean
  isError: boolean
  streamError: Error | null
  /** 可见连接态：重连中 / 致命停止时由 UI 展示 ConnectionBanner。 */
  connectionState: AgentConnectionState
  setActiveArtifactId: (id: string | null) => void
  setActiveViewId: (id: string | null) => void
  pendingApprovals: AgentApproval[]
} {
  const query = useAgentTaskQuery(taskId)
  const baseline = useMemo(
    () => (query.data ? createViewStateFromDetail(query.data) : null),
    [query.data]
  )
  const [live, setLive] = useState<AgentTaskViewState | null>(null)
  const [streamError, setStreamError] = useState<{
    taskId: string
    error: Error
  } | null>(null)
  const [connectionState, setConnectionState] =
    useState<AgentConnectionState>('live')
  // 渲染期派生：切换任务时重置连接态，避免旧任务的 stopped 残留。
  const [connTaskId, setConnTaskId] = useState<string | undefined>(taskId)
  if (connTaskId !== taskId) {
    setConnTaskId(taskId)
    setConnectionState('live')
  }
  const cursorRef = useRef(0)
  const cursorTaskIdRef = useRef<string | null>(null)
  const baselineRef = useRef<AgentTaskViewState | null>(null)
  const baselineTaskId = baseline?.task.id

  const view =
    live &&
    baseline &&
    live.task.id === baseline.task.id &&
    live.cursor >= baseline.cursor
      ? live
      : baseline

  useEffect(() => {
    if (!baseline) return
    baselineRef.current = baseline
    if (cursorTaskIdRef.current !== baseline.task.id) {
      cursorTaskIdRef.current = baseline.task.id
      cursorRef.current = baseline.cursor
      return
    }
    cursorRef.current = Math.max(cursorRef.current, baseline.cursor)
  }, [baseline])

  useEffect(() => {
    if (!taskId || baselineTaskId !== taskId) return
    const initialBaseline = baselineRef.current
    if (!initialBaseline || initialBaseline.task.id !== taskId) return
    let active = true
    const controller = new AbortController()
    let reconnectAttempt = 0
    agentDebug('live subscribe start', {
      taskId,
      status: initialBaseline.task.status,
      cursor: cursorRef.current,
      steps: initialBaseline.task.runs[0]?.steps?.map((step) => ({
        name: step.name,
        status: step.status,
      })),
    })

    const run = async () => {
      while (active && !controller.signal.aborted) {
        try {
          await streamAgentEvents({
            taskId,
            afterSequence: cursorRef.current,
            signal: controller.signal,
            onOpen: () => {
              setStreamError(null)
              setConnectionState('live')
            },
            onEvent: (event) => {
              setLive((current) => {
                const latestBaseline = baselineRef.current
                const source =
                  current &&
                  current.task.id === taskId &&
                  (!latestBaseline || current.cursor >= latestBaseline.cursor)
                    ? current
                    : latestBaseline ?? initialBaseline
                const next = applyAgentEvent(source, event)
                cursorRef.current = next.cursor
                return next
              })
            },
          })
          if (!active || controller.signal.aborted) return
          reconnectAttempt = 0
          agentDebug('live stream idle reconnect', {
            taskId,
            cursor: cursorRef.current,
          })
          // Stream ended cleanly — brief pause then reconnect for live updates.
          await waitForStreamReconnect(controller.signal, 1200)
        } catch (error) {
          if (!active || isAbortError(error)) {
            agentDebug('live subscribe stopped', {
              taskId,
              reason: isAbortError(error) ? 'abort' : 'inactive',
            })
            return
          }
          if (isFatalStreamError(error)) {
            const fatal =
              error instanceof Error
                ? error
                : new Error('任务实时连接不可用')
            agentDebugWarn('live subscribe stopped by fatal stream error', {
              taskId,
              cursor: cursorRef.current,
              error: fatal.message,
            })
            setStreamError({ taskId, error: fatal })
            setConnectionState('stopped')
            return
          }
          agentDebugWarn('live subscribe error; retrying', {
            taskId,
            cursor: cursorRef.current,
            error: error instanceof Error ? error.message : String(error),
          })
          setConnectionState('reconnecting')
          const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 30_000)
          reconnectAttempt += 1
          await waitForStreamReconnect(controller.signal, delayMs)
        }
      }
    }

    void run()
    return () => {
      agentDebug('live subscribe cleanup', { taskId })
      active = false
      controller.abort()
    }
  }, [taskId, baselineTaskId])

  const pending = useMemo(
    () =>
      (view?.task.approvals ?? []).filter(
        (approval) => approval.status === 'pending'
      ),
    [view?.task.approvals]
  )

  let fatalStreamError: Error | null = null
  if (streamError && streamError.taskId === taskId) {
    fatalStreamError = streamError.error
  }

  return {
    view,
    isLoading: query.isPending,
    isError: query.isError || Boolean(fatalStreamError),
    streamError: fatalStreamError,
    connectionState,
    setActiveArtifactId: (id) =>
      setLive((current) => {
        const source = current ?? baseline
        return source ? { ...source, activeArtifactId: id } : current
      }),
    setActiveViewId: (id) =>
      setLive((current) => {
        const source = current ?? baseline
        return source ? { ...source, activeViewId: id } : current
      }),
    pendingApprovals: pending,
  }
}
