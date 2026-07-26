import { useCallback, useEffect, useRef, useState } from 'react'

import { env } from '@/lib/env'
import { supabase } from '@/lib/supabaseClient'

const TARGET_SAMPLE_RATE = 24_000
const FRAME_DURATION_MS = 30
const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1_000
const STOP_SILENCE_MS = 600
const HANDSHAKE_TIMEOUT_MS = 12_000
const STOP_GRACE_MS = 1_800
const STOP_DEADLINE_MS = 5_000
const MAX_SOCKET_BUFFER_BYTES = 1 * 1024 * 1024

export type RealtimeVoiceStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'recording'
  | 'stopping'
  | 'error'
  | 'unsupported'

type RealtimeVoiceActivity = 'waiting' | 'speaking' | 'transcribing'

interface RealtimeVoiceState {
  status: RealtimeVoiceStatus
  activity: RealtimeVoiceActivity
  error: string | null
  partialTranscript: string
}

interface UseRealtimeVoiceInputOptions {
  value: string
  onValueChange: (value: string) => void
}

interface TranscriptSegment {
  partial: string
  final: string | null
}

interface TranscriptDraft {
  base: string
  order: string[]
  segments: Map<string, TranscriptSegment>
  seenEventIds: Set<string>
  lastEmitted: string
}

interface VoiceResources {
  runId: number
  socket: WebSocket | null
  stream: MediaStream | null
  audioContext: AudioContext | null
  source: MediaStreamAudioSourceNode | null
  worklet: AudioWorkletNode | null
  muteGain: GainNode | null
  resampler: LinearResampler | null
  framer: Pcm16Framer
  proxyReady: boolean
  sessionUpdated: boolean
  isStreaming: boolean
  intentionalAudioStop: boolean
  stopRequested: boolean
  stoppedAt: number
  sentAudio: boolean
  awaitingTranscripts: Set<string>
}

type JsonRecord = Record<string, unknown>

const initialState: RealtimeVoiceState = {
  status: 'idle',
  activity: 'waiting',
  error: null,
  partialTranscript: '',
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function appendTranscriptParts(base: string, parts: string[]): string {
  let result = base

  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue

    const needsSeparator =
      result.length > 0 &&
      !/\s$/.test(result) &&
      !/^[,，。！？.!?;；:：]/.test(part)
    result += `${needsSeparator ? ' ' : ''}${part}`
  }

  return result
}

function transcriptKey(event: JsonRecord): string | null {
  const itemId = getString(event.item_id)
  if (!itemId) return null
  const contentIndex =
    typeof event.content_index === 'number' ? event.content_index : 0
  return `${itemId}:${contentIndex}`
}

function createTranscriptDraft(base: string): TranscriptDraft {
  return {
    base,
    order: [],
    segments: new Map(),
    seenEventIds: new Set(),
    lastEmitted: base,
  }
}

function ensureTranscriptSegment(
  draft: TranscriptDraft,
  key: string
): TranscriptSegment {
  const existing = draft.segments.get(key)
  if (existing) return existing

  const segment: TranscriptSegment = { partial: '', final: null }
  draft.segments.set(key, segment)
  draft.order.push(key)
  return segment
}

function renderTranscriptDraft(draft: TranscriptDraft): string {
  return appendTranscriptParts(
    draft.base,
    draft.order.map((key) => {
      const segment = draft.segments.get(key)
      return segment?.final ?? segment?.partial ?? ''
    })
  )
}

function getLatestPartial(draft: TranscriptDraft): string {
  for (let index = draft.order.length - 1; index >= 0; index -= 1) {
    const segment = draft.segments.get(draft.order[index])
    if (segment?.final === null && segment.partial) return segment.partial
  }
  return ''
}

function pcm16ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return window.btoa(binary)
}

function encodePcm16(samples: number[]): Uint8Array {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    const pcmValue = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(index * 2, Math.round(pcmValue), true)
  })

  return new Uint8Array(buffer)
}

class Pcm16Framer {
  private pending: number[] = []

  push(samples: Float32Array): Uint8Array[] {
    for (const sample of samples) this.pending.push(sample)

    const frames: Uint8Array[] = []
    while (this.pending.length >= FRAME_SAMPLES) {
      frames.push(encodePcm16(this.pending.splice(0, FRAME_SAMPLES)))
    }
    return frames
  }

  flush(): Uint8Array[] {
    if (this.pending.length === 0) return []
    while (this.pending.length < FRAME_SAMPLES) this.pending.push(0)
    return [encodePcm16(this.pending.splice(0, FRAME_SAMPLES))]
  }
}

class LinearResampler {
  private position = 0
  private tail = new Float32Array(0)
  private readonly sourceRate: number
  private readonly targetRate: number

  constructor(sourceRate: number, targetRate: number) {
    this.sourceRate = sourceRate
    this.targetRate = targetRate
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return input
    if (this.sourceRate === this.targetRate) return input.slice()

    const combined = new Float32Array(this.tail.length + input.length)
    combined.set(this.tail)
    combined.set(input, this.tail.length)

    const ratio = this.sourceRate / this.targetRate
    const output: number[] = []
    while (this.position + 1 < combined.length) {
      const leftIndex = Math.floor(this.position)
      const fraction = this.position - leftIndex
      const left = combined[leftIndex]
      const right = combined[leftIndex + 1]
      output.push(left + (right - left) * fraction)
      this.position += ratio
    }

    const consumed = Math.min(
      Math.floor(this.position),
      Math.max(0, combined.length - 1)
    )
    this.tail = combined.slice(consumed)
    this.position -= consumed
    return Float32Array.from(output)
  }
}

function buildRealtimeVoiceUrl(): string {
  const apiBaseUrl = new URL(env.apiBaseUrl, window.location.origin)
  const socketUrl = new URL('/api/v1/realtime/voice', apiBaseUrl)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  socketUrl.username = ''
  socketUrl.password = ''
  socketUrl.search = ''
  socketUrl.hash = ''
  return socketUrl.toString()
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝，请在浏览器设置中允许后重试'
    }
    if (error.name === 'NotFoundError') {
      return '未检测到可用麦克风'
    }
    if (error.name === 'NotReadableError') {
      return '麦克风正被其他应用占用，请关闭后重试'
    }
  }
  return '无法启动麦克风，请检查设备后重试'
}

const proxyErrorMessages: Record<string, string> = {
  invalid_auth: '登录状态已失效，请重新登录',
  auth_timeout: '语音服务认证超时，请重试',
  auth_unavailable: '认证服务暂时不可用，请稍后重试',
  origin_not_allowed: '当前页面来源不允许使用语音服务',
  too_many_sessions: '同时开启的语音会话过多，请稍后重试',
  invalid_event: '语音数据格式不被服务接受，请重试',
  session_expired: '本次语音会话已到时限，请重新开始',
  provider_not_configured: '语音输入尚未配置',
  upstream_unavailable: '语音识别服务暂时不可用，请稍后重试',
}

function serverErrorMessage(event: JsonRecord): string {
  if (event.type === 'proxy.error') {
    const code = getString(event.code)
    return (code && proxyErrorMessages[code]) || '语音服务连接失败，请重试'
  }

  const details = isRecord(event.error) ? event.error : null
  const code = getString(details?.code)
  if (code === 'risk_blocked') return '这段语音无法处理，请换一种表达'
  if (code === 'max_idle_timeout') return '语音会话空闲超时，请重新开始'
  return '语音识别失败，请重试'
}

function socketCloseMessage(event: CloseEvent): string {
  if (event.code === 4401) return proxyErrorMessages.invalid_auth
  if (event.code === 4403) return proxyErrorMessages.origin_not_allowed
  if (event.code === 1008) return proxyErrorMessages.invalid_event
  if (event.code === 1013) return '语音服务暂时繁忙，请稍后重试'
  if (event.code === 1011) return proxyErrorMessages.upstream_unavailable
  return '语音连接已断开，请重试'
}

function createVoiceResources(runId: number): VoiceResources {
  return {
    runId,
    socket: null,
    stream: null,
    audioContext: null,
    source: null,
    worklet: null,
    muteGain: null,
    resampler: null,
    framer: new Pcm16Framer(),
    proxyReady: false,
    sessionUpdated: false,
    isStreaming: false,
    intentionalAudioStop: false,
    stopRequested: false,
    stoppedAt: 0,
    sentAudio: false,
    awaitingTranscripts: new Set(),
  }
}

function transmitAudioFrame(
  resources: VoiceResources,
  frame: Uint8Array
): string | null {
  const socket = resources.socket
  if (!resources.isStreaming || socket?.readyState !== WebSocket.OPEN) {
    return null
  }
  if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
    return '网络拥堵，语音上传已停止，请重试'
  }

  socket.send(
    JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: pcm16ToBase64(frame),
    })
  )
  resources.sentAudio = true
  return null
}

export function useRealtimeVoiceInput({
  value,
  onValueChange,
}: UseRealtimeVoiceInputOptions) {
  const [state, setState] = useState<RealtimeVoiceState>(initialState)
  const stateRef = useRef(initialState)
  const optionsRef = useRef({ value, onValueChange })
  const resourcesRef = useRef<VoiceResources | null>(null)
  const transcriptRef = useRef(createTranscriptDraft(value))
  const runIdRef = useRef(0)
  const handshakeTimerRef = useRef<number | null>(null)
  const stopGraceTimerRef = useRef<number | null>(null)
  const stopDeadlineTimerRef = useRef<number | null>(null)

  useEffect(() => {
    optionsRef.current = { value, onValueChange }
  }, [onValueChange, value])

  const updateState = useCallback((patch: Partial<RealtimeVoiceState>) => {
    const next = { ...stateRef.current, ...patch }
    stateRef.current = next
    setState(next)
  }, [])

  const clearTimers = useCallback(() => {
    if (handshakeTimerRef.current !== null) {
      window.clearTimeout(handshakeTimerRef.current)
      handshakeTimerRef.current = null
    }
    if (stopGraceTimerRef.current !== null) {
      window.clearTimeout(stopGraceTimerRef.current)
      stopGraceTimerRef.current = null
    }
    if (stopDeadlineTimerRef.current !== null) {
      window.clearTimeout(stopDeadlineTimerRef.current)
      stopDeadlineTimerRef.current = null
    }
  }, [])

  const releaseAudio = useCallback((resources: VoiceResources) => {
    resources.intentionalAudioStop = true
    resources.isStreaming = false
    if (resources.worklet) resources.worklet.port.onmessage = null
    resources.worklet?.disconnect()
    resources.source?.disconnect()
    resources.muteGain?.disconnect()
    resources.stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    if (resources.audioContext) {
      void resources.audioContext.close().catch(() => undefined)
    }
    resources.stream = null
    resources.audioContext = null
    resources.source = null
    resources.worklet = null
    resources.muteGain = null
    resources.resampler = null
  }, [])

  const cleanupResources = useCallback(() => {
    clearTimers()
    const resources = resourcesRef.current
    if (!resources) return

    releaseAudio(resources)
    if (resources.socket) {
      resources.socket.onopen = null
      resources.socket.onmessage = null
      resources.socket.onerror = null
      resources.socket.onclose = null
      if (
        resources.socket.readyState === WebSocket.OPEN ||
        resources.socket.readyState === WebSocket.CONNECTING
      ) {
        resources.socket.close(1000, 'voice input ended')
      }
    }
    resources.socket = null
    resourcesRef.current = null
  }, [clearTimers, releaseAudio])

  const fail = useCallback(
    (message: string, status: RealtimeVoiceStatus = 'error') => {
      runIdRef.current += 1
      cleanupResources()
      updateState({
        status,
        activity: 'waiting',
        error: message,
        partialTranscript: '',
      })
    },
    [cleanupResources, updateState]
  )

  const finishSession = useCallback(() => {
    runIdRef.current += 1
    cleanupResources()
    updateState({
      status: 'idle',
      activity: 'waiting',
      error: null,
      partialTranscript: '',
    })
  }, [cleanupResources, updateState])

  const emitTranscriptDraft = useCallback(() => {
    const transcriptDraft = transcriptRef.current
    const nextDraft = renderTranscriptDraft(transcriptDraft)
    const partialTranscript = getLatestPartial(transcriptDraft)

    if (nextDraft !== transcriptDraft.lastEmitted) {
      transcriptDraft.lastEmitted = nextDraft
      optionsRef.current.value = nextDraft
      optionsRef.current.onValueChange(nextDraft)
    }
    updateState({ partialTranscript })
  }, [updateState])

  const applyTranscriptEvent = useCallback(
    (event: JsonRecord, isFinal: boolean) => {
      const key = transcriptKey(event)
      if (!key) return
      const transcriptDraft = transcriptRef.current
      const eventId = getString(event.event_id)
      if (eventId && transcriptDraft.seenEventIds.has(eventId)) return
      if (eventId) transcriptDraft.seenEventIds.add(eventId)

      const segment = ensureTranscriptSegment(transcriptDraft, key)

      if (isFinal) {
        const transcript = getString(event.transcript)?.trim() ?? ''
        if (segment.final === transcript) return
        segment.final = transcript
        segment.partial = ''
      } else {
        const delta = getString(event.delta)
        const text = getString(event.text) ?? ''
        const stash = getString(event.stash) ?? ''
        // The OpenAI-compatible event uses append-only `delta`. Keep support
        // for StepFun's observed cumulative text/stash shape as a fallback.
        const partial =
          delta !== null
            ? `${segment.partial}${delta}`
            : `${text}${stash && !text.endsWith(stash) ? stash : ''}`.trim()
        if (!partial.trim() || segment.partial === partial) return
        segment.partial = partial
      }

      emitTranscriptDraft()
    },
    [emitTranscriptDraft]
  )

  const scheduleStoppedFinish = useCallback(
    (resources: VoiceResources) => {
      if (
        !resources.stopRequested ||
        resources.awaitingTranscripts.size > 0 ||
        stopGraceTimerRef.current !== null
      ) {
        return
      }

      const elapsed = Date.now() - resources.stoppedAt
      const delay = Math.max(350, STOP_GRACE_MS - elapsed)
      stopGraceTimerRef.current = window.setTimeout(() => {
        stopGraceTimerRef.current = null
        if (
          resourcesRef.current === resources &&
          resources.awaitingTranscripts.size === 0
        ) {
          finishSession()
        }
      }, delay)
    },
    [finishSession]
  )

  const start = useCallback(async () => {
    if (
      stateRef.current.status === 'requesting' ||
      stateRef.current.status === 'connecting' ||
      stateRef.current.status === 'recording' ||
      stateRef.current.status === 'stopping'
    ) {
      return
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext
        }
      ).webkitAudioContext
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !AudioContextConstructor ||
      !window.AudioWorkletNode ||
      !window.WebSocket
    ) {
      fail(
        '当前浏览器或页面环境不支持实时麦克风，请使用最新版浏览器并通过 HTTPS 访问',
        'unsupported'
      )
      return
    }

    cleanupResources()
    const runId = ++runIdRef.current
    const resources = createVoiceResources(runId)
    resourcesRef.current = resources
    transcriptRef.current = createTranscriptDraft(optionsRef.current.value)
    updateState({
      status: 'requesting',
      activity: 'waiting',
      error: null,
      partialTranscript: '',
    })

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    if (runIdRef.current !== runId) return
    if (sessionError || !session?.access_token) {
      fail('登录状态已失效，请重新登录')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      if (runIdRef.current === runId) fail(microphoneErrorMessage(error))
      return
    }
    if (runIdRef.current !== runId) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    resources.stream = stream

    try {
      let audioContext: AudioContext
      try {
        audioContext = new AudioContextConstructor({
          sampleRate: TARGET_SAMPLE_RATE,
        })
      } catch {
        audioContext = new AudioContextConstructor()
      }
      resources.audioContext = audioContext
      if (!audioContext.audioWorklet) {
        fail('当前浏览器不支持实时音频处理，请升级浏览器后重试', 'unsupported')
        return
      }

      const workletUrl = new URL(
        `${import.meta.env.BASE_URL}realtime-voice-worklet.js`,
        window.location.origin
      )
      await audioContext.audioWorklet.addModule(workletUrl.toString())
      if (runIdRef.current !== runId) return

      const source = audioContext.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(
        audioContext,
        'xengine-realtime-voice-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }
      )
      const muteGain = audioContext.createGain()
      muteGain.gain.value = 0
      source.connect(worklet)
      worklet.connect(muteGain)
      muteGain.connect(audioContext.destination)

      resources.source = source
      resources.worklet = worklet
      resources.muteGain = muteGain
      resources.resampler = new LinearResampler(
        audioContext.sampleRate,
        TARGET_SAMPLE_RATE
      )

      worklet.port.onmessage = (message: MessageEvent<unknown>) => {
        if (
          resourcesRef.current !== resources ||
          !resources.isStreaming ||
          !isRecord(message.data) ||
          message.data.type !== 'audio' ||
          !(message.data.samples instanceof ArrayBuffer) ||
          !resources.resampler
        ) {
          return
        }

        const input = new Float32Array(message.data.samples)
        const resampled = resources.resampler.process(input)
        for (const frame of resources.framer.push(resampled)) {
          const uploadError = transmitAudioFrame(resources, frame)
          if (uploadError) {
            fail(uploadError)
            return
          }
        }
      }

      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (
            resourcesRef.current === resources &&
            !resources.intentionalAudioStop
          ) {
            fail('麦克风连接已断开，请检查设备后重试')
          }
        }
      })

      await audioContext.resume()
      if (runIdRef.current !== runId) return
    } catch (error) {
      console.error('realtime voice audio initialization failed:', error)
      if (runIdRef.current === runId) {
        fail('无法初始化实时音频处理，请升级浏览器后重试')
      }
      return
    }

    updateState({ status: 'connecting', activity: 'waiting' })

    let socket: WebSocket
    try {
      socket = new WebSocket(buildRealtimeVoiceUrl())
    } catch {
      fail('语音服务地址无效，请检查前端 API 配置')
      return
    }
    resources.socket = socket

    const beginStreamingIfReady = () => {
      if (
        resourcesRef.current !== resources ||
        !resources.proxyReady ||
        !resources.sessionUpdated ||
        resources.isStreaming
      ) {
        return
      }
      if (handshakeTimerRef.current !== null) {
        window.clearTimeout(handshakeTimerRef.current)
        handshakeTimerRef.current = null
      }
      resources.isStreaming = true
      updateState({
        status: 'recording',
        activity: 'waiting',
        error: null,
      })
    }

    socket.onopen = () => {
      if (resourcesRef.current !== resources) return
      socket.send(
        JSON.stringify({
          type: 'proxy.auth',
          accessToken: session.access_token,
        })
      )
    }

    socket.onmessage = (message) => {
      if (resourcesRef.current !== resources) return

      let event: JsonRecord
      try {
        const parsed: unknown = JSON.parse(String(message.data))
        if (!isRecord(parsed) || typeof parsed.type !== 'string') {
          throw new Error('invalid server event')
        }
        event = parsed
      } catch {
        fail('语音服务返回了无法识别的数据')
        return
      }

      switch (event.type) {
        case 'proxy.ready':
          if (
            event.audioFormat !== 'pcm16' ||
            event.sampleRateHz !== TARGET_SAMPLE_RATE ||
            event.frameDurationMs !== FRAME_DURATION_MS
          ) {
            fail('语音服务返回了不支持的音频参数')
            return
          }
          resources.proxyReady = true
          beginStreamingIfReady()
          break
        case 'session.updated': {
          const sessionConfig = isRecord(event.session) ? event.session : null
          if (
            sessionConfig?.input_audio_format &&
            sessionConfig.input_audio_format !== 'pcm16'
          ) {
            fail('语音会话未使用 PCM16 输入格式')
            return
          }
          resources.sessionUpdated = true
          beginStreamingIfReady()
          break
        }
        case 'input_audio_buffer.speech_started': {
          const key = transcriptKey(event)
          if (key) {
            ensureTranscriptSegment(transcriptRef.current, key)
            resources.awaitingTranscripts.add(key)
          }
          updateState({ activity: 'speaking' })
          break
        }
        case 'input_audio_buffer.speech_stopped': {
          const key = transcriptKey(event)
          if (key) resources.awaitingTranscripts.add(key)
          updateState({ activity: 'transcribing' })
          break
        }
        case 'conversation.item.input_audio_transcription.delta': {
          const key = transcriptKey(event)
          if (key) resources.awaitingTranscripts.add(key)
          applyTranscriptEvent(event, false)
          break
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const key = transcriptKey(event)
          applyTranscriptEvent(event, true)
          if (key) resources.awaitingTranscripts.delete(key)
          updateState({
            activity: 'waiting',
            partialTranscript: getLatestPartial(transcriptRef.current),
          })
          scheduleStoppedFinish(resources)
          break
        }
        case 'response.created':
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'response.cancel' }))
          }
          break
        case 'proxy.error':
        case 'error':
          fail(serverErrorMessage(event))
          break
        default:
          break
      }
    }

    // Browsers expose no useful details on `error`; the following `close`
    // event carries the proxy's stable close code. The handshake timeout is
    // still the fallback for a transport that never reaches `close`.
    socket.onerror = () => undefined

    socket.onclose = (event) => {
      if (resourcesRef.current !== resources) return
      if (resources.stopRequested) {
        finishSession()
      } else {
        fail(socketCloseMessage(event))
      }
    }

    handshakeTimerRef.current = window.setTimeout(() => {
      if (
        resourcesRef.current === resources &&
        (!resources.proxyReady || !resources.sessionUpdated)
      ) {
        fail('语音服务连接超时，请重试')
      }
    }, HANDSHAKE_TIMEOUT_MS)
  }, [
    applyTranscriptEvent,
    cleanupResources,
    fail,
    finishSession,
    scheduleStoppedFinish,
    updateState,
  ])

  const stop = useCallback(() => {
    const resources = resourcesRef.current
    if (!resources) {
      finishSession()
      return
    }

    if (
      stateRef.current.status === 'requesting' ||
      stateRef.current.status === 'connecting'
    ) {
      finishSession()
      return
    }
    if (stateRef.current.status !== 'recording') return

    resources.stopRequested = true
    resources.stoppedAt = Date.now()
    updateState({ status: 'stopping', activity: 'transcribing' })

    resources.intentionalAudioStop = true
    resources.worklet?.disconnect()
    resources.source?.disconnect()
    resources.stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })

    if (resources.isStreaming && resources.sentAudio) {
      const silence = new Float32Array(
        (TARGET_SAMPLE_RATE * STOP_SILENCE_MS) / 1_000
      )
      const frames = [
        ...resources.framer.push(silence),
        ...resources.framer.flush(),
      ]
      for (const frame of frames) {
        const uploadError = transmitAudioFrame(resources, frame)
        if (uploadError) {
          fail(uploadError)
          return
        }
      }
    }
    resources.isStreaming = false
    releaseAudio(resources)

    scheduleStoppedFinish(resources)
    stopDeadlineTimerRef.current = window.setTimeout(() => {
      if (resourcesRef.current !== resources) return
      if (resources.awaitingTranscripts.size > 0) {
        fail('录音已停止，但最终转录未返回，请检查草稿后重试')
      } else {
        finishSession()
      }
    }, STOP_DEADLINE_MS)
  }, [
    fail,
    finishSession,
    releaseAudio,
    scheduleStoppedFinish,
    updateState,
  ])

  useEffect(
    () => () => {
      runIdRef.current += 1
      cleanupResources()
    },
    [cleanupResources]
  )

  const isActive =
    state.status === 'requesting' ||
    state.status === 'connecting' ||
    state.status === 'recording' ||
    state.status === 'stopping'

  const statusLabel =
    state.status === 'requesting'
      ? '等待麦克风权限…'
      : state.status === 'connecting'
        ? '正在连接语音服务…'
        : state.status === 'stopping'
          ? '正在整理最终转录…'
          : state.status === 'recording' && state.activity === 'speaking'
            ? '检测到语音，正在听写…'
            : state.status === 'recording' &&
                state.activity === 'transcribing'
              ? '正在识别，可继续说话'
              : state.status === 'recording'
                ? '正在录音，点击麦克风停止'
                : state.status === 'error' || state.status === 'unsupported'
                  ? '语音输入不可用'
                  : '语音输入'

  return {
    status: state.status,
    statusLabel,
    error: state.error,
    partialTranscript: state.partialTranscript,
    isActive,
    isRecording: state.status === 'recording',
    start,
    stop,
  }
}
