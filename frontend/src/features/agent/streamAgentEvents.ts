import { env } from '@/lib/env'
import { supabase } from '@/lib/supabaseClient'
import { agentDebug, agentDebugWarn, summarizeAgentEvent } from './agentDebug'
import type { AgentEvent } from './types'

export class AgentEventStreamError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentEventStreamError'
    this.code = code
  }
}

interface StreamAgentEventsOptions {
  taskId: string
  afterSequence?: number
  signal: AbortSignal
  onEvent: (event: AgentEvent) => void
  onHeartbeat?: () => void
  onOpen?: () => void
}

interface SseFrame {
  id?: string
  event: string
  data: string
}

function parseSseFrame(frame: string): SseFrame | null {
  let event = 'message'
  let id: string | undefined
  const dataLines: string[] = []

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (dataLines.length === 0) return null
  return { id, event, data: dataLines.join('\n') }
}

/**
 * Replayable SSE client for GET /api/v1/agent-tasks/{id}/events.
 * Sends Last-Event-ID so the server can replay missing durable events.
 */
export async function streamAgentEvents(
  options: StreamAgentEventsOptions
): Promise<void> {
  const { taskId, afterSequence = 0, signal, onEvent, onHeartbeat, onOpen } = options

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    agentDebugWarn('events stream aborted: no session', { taskId })
    throw new AgentEventStreamError('invalid_token', 'No active Supabase session')
  }

  const url = new URL(
    `${env.apiBaseUrl.replace(/\/+$/, '')}/api/v1/agent-tasks/${taskId}/events`
  )
  if (afterSequence > 0) {
    url.searchParams.set('after', String(afterSequence))
  }

  agentDebug('events stream connecting', {
    taskId,
    afterSequence,
    url: url.toString(),
  })

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${session.access_token}`,
      ...(afterSequence > 0
        ? { 'Last-Event-ID': String(afterSequence) }
        : {}),
    },
    signal,
  })

  if (!response.ok) {
    agentDebugWarn('events stream HTTP error', {
      taskId,
      status: response.status,
      afterSequence,
    })
    throw new AgentEventStreamError(
      `http_${response.status}`,
      `HTTP ${response.status}`
    )
  }
  if (!response.body) {
    agentDebugWarn('events stream has no body', { taskId })
    throw new AgentEventStreamError(
      'stream_interrupted',
      'Response has no readable body'
    )
  }

  agentDebug('events stream open', { taskId, afterSequence })
  onOpen?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventCount = 0
  let heartbeatCount = 0

  const handleFrame = (frame: string) => {
    const parsed = parseSseFrame(frame)
    if (!parsed) return
    if (parsed.event === 'heartbeat') {
      heartbeatCount += 1
      if (heartbeatCount === 1 || heartbeatCount % 10 === 0) {
        agentDebug('events heartbeat', { taskId, heartbeatCount })
      }
      onHeartbeat?.()
      return
    }
    if (parsed.event === 'error') {
      const payload = JSON.parse(parsed.data) as {
        code?: string
        message?: string
      }
      agentDebugWarn('events stream error frame', {
        taskId,
        code: payload.code,
        message: payload.message,
      })
      throw new AgentEventStreamError(
        payload.code ?? 'agent_event_error',
        payload.message ?? 'Agent event stream failed'
      )
    }
    const payload = JSON.parse(parsed.data) as AgentEvent
    if (!payload.sequence && parsed.id) {
      payload.sequence = Number(parsed.id)
    }
    eventCount += 1
    agentDebug('event', {
      taskId,
      ...summarizeAgentEvent(payload),
    })
    onEvent(payload)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        handleFrame(frame)
      }
    }
    if (buffer.trim()) handleFrame(buffer)
    agentDebug('events stream ended', {
      taskId,
      eventCount,
      heartbeatCount,
      lastAfter: afterSequence,
    })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      agentDebugWarn('events stream failed', {
        taskId,
        eventCount,
        error: error instanceof Error ? error.message : String(error),
      })
    } else {
      agentDebug('events stream aborted', { taskId, eventCount })
    }
    throw error
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}
