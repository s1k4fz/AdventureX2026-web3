/** Browser console debug helpers for Agent Task live execution. */

const PREFIX = '[agent]'

export function agentDebug(
  message: string,
  detail?: Record<string, unknown>
): void {
  if (detail) {
    console.debug(PREFIX, message, detail)
  } else {
    console.debug(PREFIX, message)
  }
}

export function agentDebugWarn(
  message: string,
  detail?: Record<string, unknown>
): void {
  if (detail) {
    console.warn(PREFIX, message, detail)
  } else {
    console.warn(PREFIX, message)
  }
}

export function summarizeAgentEvent(event: {
  sequence?: number
  eventType?: string
  data?: Record<string, unknown>
  runId?: string | null
}): Record<string, unknown> {
  const data = event.data ?? {}
  const summary: Record<string, unknown> = {
    seq: event.sequence,
    type: event.eventType,
  }
  if (event.runId) summary.runId = event.runId
  if (typeof data.step === 'string') summary.step = data.step
  if (typeof data.status === 'string') summary.status = data.status
  if (typeof data.kind === 'string') summary.kind = data.kind
  if (typeof data.phase === 'string') summary.phase = data.phase
  if (typeof data.summary === 'string') summary.summary = data.summary
  if (typeof data.crumb === 'string') {
    summary.crumb =
      data.crumb.length > 120 ? `${data.crumb.slice(0, 120)}…` : data.crumb
  }
  if (typeof data.code === 'string') summary.code = data.code
  if (typeof data.message === 'string') summary.message = data.message
  if (Array.isArray(data.platforms)) summary.platforms = data.platforms
  if (typeof data.totalCount === 'number') summary.totalCount = data.totalCount
  if (typeof data.index === 'number') summary.index = data.index
  if (typeof data.query === 'string') summary.query = data.query
  return summary
}
