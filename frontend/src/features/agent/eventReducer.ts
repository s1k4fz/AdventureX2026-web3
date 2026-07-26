import {
  summarizeApprovalCreated,
  summarizeResearchUpdated,
  summarizeSubagentEvent,
} from './activitySummaries'
import type {
  AgentEvent,
  AgentSubagent,
  AgentSubagentKind,
  AgentSubagentStatus,
  AgentTaskDetail,
  AgentTaskViewState,
} from './types'

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((row) => row.id === item.id)
  if (index < 0) return [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}

/** Pure reducer: snapshot is baseline; events apply in sequence order. */
export function applyAgentEvent(
  state: AgentTaskViewState,
  event: AgentEvent
): AgentTaskViewState {
  if (event.sequence <= state.cursor) {
    return state
  }

  const task: AgentTaskDetail = {
    ...state.task,
    recentEvents: [...state.task.recentEvents, event].slice(-80),
    latestSequence: event.sequence,
  }

  let activities = state.activities
  let activeArtifactId = state.activeArtifactId
  let activeViewId = state.activeViewId

  switch (event.eventType) {
    case 'task.created':
      task.status = 'running'
      break
    case 'task.cancelled':
      task.status = 'cancelled'
      break
    case 'task.renamed':
      if (typeof event.data.title === 'string') task.title = event.data.title
      if (typeof event.data.description === 'string')
        task.description = event.data.description
      break
    case 'task.failed':
      task.status = 'failed'
      task.errorCode = String(event.data.code ?? task.errorCode ?? '')
      task.errorMessage = String(event.data.message ?? task.errorMessage ?? '')
      break
    case 'step.failed': {
      // The intake search worker currently emits this terminal event after it
      // has persisted the task failure. Treat it as terminal locally too so a
      // delayed snapshot cannot leave the workspace on the research screen.
      const stepName = String(event.data.step ?? event.data.name ?? '')
      const errorCode =
        typeof event.data.code === 'string' ? event.data.code : undefined
      const errorMessage =
        typeof event.data.message === 'string'
          ? event.data.message
          : stepName
            ? `${stepName} 执行失败，请重试。`
            : '任务步骤执行失败，请重试。'
      if (stepName && task.runs.length) {
        task.runs = task.runs.map((run) => {
          if (event.runId && run.id !== event.runId) return run
          return {
            ...run,
            status: 'failed',
            errorCode: errorCode ?? run.errorCode,
            errorMessage,
            steps: run.steps.map((step) =>
              step.name === stepName
                ? {
                    ...step,
                    status: 'failed',
                    errorCode: errorCode ?? step.errorCode,
                    errorMessage,
                  }
                : step
            ),
          }
        })
      }
      task.status = 'failed'
      task.errorCode = errorCode ?? task.errorCode
      task.errorMessage = errorMessage
      break
    }
    case 'task.monitoring':
      task.status = 'monitoring'
      // Funding is a terminal action for the user, but the task continues in
      // monitoring.  Move the canvas immediately instead of leaving a stale
      // funding artifact selected until the user refreshes or clicks a tab.
      activeViewId = 'policy-journey'
      break
    case 'step.updated': {
      const stepName = String(event.data.name ?? '')
      const stepStatus = String(event.data.status ?? '')
      if (stepName && task.runs.length) {
        const runId = event.runId
        task.runs = task.runs.map((run) => {
          if (runId && run.id !== runId) return run
          return {
            ...run,
            steps: run.steps.map((step) =>
              step.name === stepName
                ? {
                    ...step,
                    status: stepStatus as AgentTaskDetail['runs'][number]['steps'][number]['status'],
                    errorCode:
                      typeof event.data.errorCode === 'string'
                        ? event.data.errorCode
                        : step.errorCode,
                    errorMessage:
                      typeof event.data.errorMessage === 'string'
                        ? event.data.errorMessage
                        : step.errorMessage,
                    progress:
                      event.data.progress &&
                      typeof event.data.progress === 'object'
                        ? (event.data.progress as Record<string, unknown>)
                        : step.progress,
                  }
                : step
            ),
          }
        })
      }
      break
    }
    case 'activity': {
      const summary = String(event.data.summary ?? '进度更新')
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary,
          createdAt: event.createdAt,
          crumb:
            typeof event.data.crumb === 'string' ? event.data.crumb : undefined,
        },
      ].slice(-100)
      break
    }
    case 'input.queued': {
      const inputId = String(event.data.inputId ?? '')
      const revision = Number(event.data.revision ?? task.inputRevision ?? 0)
      task.inputRevision = revision
      if (inputId) {
        task.inputs = upsertById(task.inputs ?? [], {
          id: inputId,
          type:
            event.data.type === 'revise_goal' ? 'revise_goal' : 'free_text',
          text: String(event.data.text ?? ''),
          revision,
          status: 'queued',
          createdAt: event.createdAt,
          appliedAt: null,
        })
      }
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary: '已接收你的补充，正在安全切换当前阶段',
          createdAt: event.createdAt,
          crumb: typeof event.data.text === 'string' ? event.data.text : undefined,
        },
      ].slice(-100)
      break
    }
    case 'input.applying': {
      const inputId = String(event.data.inputId ?? '')
      const revision = Number(event.data.revision ?? task.inputRevision ?? 0)
      task.inputRevision = revision
      task.inputs = (task.inputs ?? []).map((input) =>
        input.id === inputId || input.revision === revision
          ? { ...input, status: 'applying' }
          : input
      )
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary: String(
            event.data.summary ?? '正在按新的用户输入续跑任务'
          ),
          createdAt: event.createdAt,
        },
      ].slice(-100)
      break
    }
    case 'input.applied': {
      const revision = Number(event.data.revision ?? task.inputRevision ?? 0)
      task.inputs = (task.inputs ?? []).map((input) =>
        input.revision <= revision &&
        (input.status === 'queued' || input.status === 'applying')
          ? { ...input, status: 'applied', appliedAt: event.createdAt }
          : input
      )
      break
    }
    case 'approval.created': {
      task.status = 'waiting_user'
      const approvalId = String(event.data.approvalId ?? '')
      if (approvalId) {
        task.approvals = upsertById(task.approvals, {
          id: approvalId,
          kind: event.data.kind as AgentTaskDetail['approvals'][number]['kind'],
          status: 'pending',
          version: Number(event.data.version ?? 1),
          payload: (event.data.payload as Record<string, unknown>) ?? null,
          response: null,
          submittedAt: null,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        })
      }
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary: summarizeApprovalCreated(event.data.kind),
          createdAt: event.createdAt,
        },
      ]
      break
    }
    case 'approval.submitted': {
      const approvalId = String(event.data.approvalId ?? '')
      const response =
        event.data.response && typeof event.data.response === 'object'
          ? (event.data.response as Record<string, unknown>)
          : undefined
      task.approvals = task.approvals.map((approval) =>
        approval.id === approvalId
          ? {
              ...approval,
              status: 'submitted',
              response: response ?? approval.response,
              submittedAt: event.createdAt,
              updatedAt: event.createdAt,
            }
          : approval
      )
      task.status = 'running'
      break
    }
    case 'artifact.upserted': {
      const refId = String(event.data.refId ?? '')
      const refType = String(event.data.refType ?? '')
      if (refId && refType) {
        const existing = task.artifacts.find(
          (artifact) =>
            artifact.refId === refId && artifact.refType === refType
        )
        const artifact = {
          id: existing?.id ?? `tmp-${refType}-${refId}`,
          refType,
          refId,
          role: String(event.data.role ?? 'primary'),
          label:
            typeof event.data.label === 'string'
              ? event.data.label
              : (existing?.label ?? null),
          meta: existing?.meta ?? null,
          createdAt: existing?.createdAt ?? event.createdAt,
        }
        task.artifacts = upsertById(task.artifacts, artifact)
        task.primaryRefType = refType
        task.primaryRefId = refId
        if (!activeArtifactId) activeArtifactId = artifact.id
      }
      break
    }
    case 'subagent.fanout':
    case 'subagent.fanin': {
      const summary = summarizeSubagentEvent(event.eventType, event.data)
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary,
          createdAt: event.createdAt,
          crumb:
            typeof event.data.summary === 'string'
              ? event.data.summary
              : undefined,
        },
      ].slice(-100)
      break
    }
    case 'subagent.started':
    case 'subagent.updated':
    case 'subagent.completed':
    case 'subagent.failed': {
      const kind = String(event.data.kind ?? '') as AgentSubagentKind
      const status = String(
        event.data.status ??
          (event.eventType === 'subagent.failed'
            ? 'failed'
            : event.eventType === 'subagent.completed'
              ? 'succeeded'
              : 'running')
      ) as AgentSubagentStatus
      const subagentId = String(event.data.subagentId ?? `kind-${kind}`)
      const summary = summarizeSubagentEvent(event.eventType, event.data)
      const queryText =
        typeof event.data.query === 'string'
          ? event.data.query
          : typeof event.data.queryText === 'string'
            ? event.data.queryText
            : null
      const parentStep =
        typeof event.data.parentStep === 'string'
          ? event.data.parentStep
          : 'market_search'
      const progressFromEvent =
        event.data.progress && typeof event.data.progress === 'object'
          ? (event.data.progress as Record<string, unknown>)
          : event.eventType === 'subagent.updated' &&
              typeof event.data.summary === 'string'
            ? { summary: event.data.summary }
            : null
      const nextRow: AgentSubagent = {
        id: subagentId,
        kind: kind || 'polymarket',
        status,
        parentStep,
        queryText,
        progress: progressFromEvent,
        brief:
          event.data.brief && typeof event.data.brief === 'object'
            ? (event.data.brief as Record<string, unknown>)
            : null,
        errorCode:
          typeof event.data.errorCode === 'string'
            ? event.data.errorCode
            : null,
        errorMessage:
          typeof event.data.errorMessage === 'string'
            ? event.data.errorMessage
            : null,
        startedAt:
          event.eventType === 'subagent.started'
            ? event.createdAt
            : undefined,
        finishedAt:
          event.eventType === 'subagent.completed' ||
          event.eventType === 'subagent.failed'
            ? event.createdAt
            : undefined,
        createdAt: event.createdAt,
        runId: event.runId ?? null,
      }
      const existing = (task.subagents ?? []).find(
        (row) => row.id === subagentId || row.kind === kind
      )
      const merged: AgentSubagent = {
        ...existing,
        ...nextRow,
        id: existing?.id ?? nextRow.id,
        startedAt: existing?.startedAt ?? nextRow.startedAt ?? null,
        createdAt: existing?.createdAt ?? nextRow.createdAt,
        brief: nextRow.brief ?? existing?.brief ?? null,
        progress: nextRow.progress ?? existing?.progress ?? null,
        queryText: nextRow.queryText ?? existing?.queryText ?? null,
        parentStep: nextRow.parentStep ?? existing?.parentStep,
      }
      task.subagents = upsertById(task.subagents ?? [], merged)
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary,
          createdAt: event.createdAt,
          crumb:
            typeof event.data.summary === 'string'
              ? event.data.summary
              : undefined,
        },
      ].slice(-100)
      break
    }
    case 'research.updated': {
      const summary = summarizeResearchUpdated(event.data)
      const crumbParts: string[] = []
      const query =
        typeof event.data.query === 'string' ? event.data.query.trim() : ''
      const items = Array.isArray(event.data.items) ? event.data.items : []
      if (query) crumbParts.push(`查询：${query}`)
      for (const item of items.slice(0, 3)) {
        if (!item || typeof item !== 'object') continue
        const question = (item as { question?: unknown }).question
        const platform = (item as { platform?: unknown }).platform
        if (typeof question !== 'string' || !question.trim()) continue
        const prefix =
          typeof platform === 'string' && platform.trim()
            ? `[${platform.trim()}] `
            : ''
        crumbParts.push(`${prefix}${question.trim()}`)
      }
      if (items.length > 3) {
        crumbParts.push(`…另有 ${items.length - 3} 个候选`)
      }
      // Skip noisy duplicate activities when this is a subagent sources projection.
      const isSourceOnly =
        event.data.phase === 'source' &&
        !items.length &&
        typeof event.data.kind === 'string'
      if (!isSourceOnly) {
        activities = [
          ...activities,
          {
            id: event.id,
            sequence: event.sequence,
            summary,
            createdAt: event.createdAt,
            crumb: crumbParts.length ? crumbParts.join('\n') : undefined,
          },
        ]
      }
      break
    }
    case 'model.explanation.updated': {
      // Forward-compat: surface as activity so legacy consumers still see progress.
      // PolicyJourneyState parses the full payload via journeyReducer.
      const summary =
        typeof event.data.summary === 'string' && event.data.summary.trim()
          ? event.data.summary.trim()
          : '模型观测已更新'
      activities = [
        ...activities,
        {
          id: event.id,
          sequence: event.sequence,
          summary,
          createdAt: event.createdAt,
          crumb:
            typeof event.data.stage === 'string'
              ? event.data.stage
              : undefined,
        },
      ].slice(-100)
      break
    }
    default:
      break
  }

  return {
    task,
    cursor: event.sequence,
    activities,
    activeArtifactId,
    activeViewId,
  }
}

export function applyAgentEvents(
  state: AgentTaskViewState,
  events: AgentEvent[]
): AgentTaskViewState {
  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .reduce(applyAgentEvent, state)
}

export function createViewStateFromDetail(
  detail: AgentTaskDetail
): AgentTaskViewState {
  const baseline: AgentTaskViewState = {
    task: { ...detail, recentEvents: [] },
    cursor: 0,
    activities: [],
    activeArtifactId: detail.artifacts[0]?.id ?? null,
    activeViewId: null,
  }
  return applyAgentEvents(baseline, detail.recentEvents ?? [])
}

export function pendingApprovals(detail: AgentTaskDetail) {
  return detail.approvals.filter((approval) => approval.status === 'pending')
}

export function latestRun(detail: AgentTaskDetail) {
  if (!detail.runs.length) return null
  return detail.runs[detail.runs.length - 1] ?? null
}
