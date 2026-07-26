import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  ShieldCheck,
  Square,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import {
  formatBytes,
  serializeAgentMessage,
  type AgentAttachment,
} from '@/lib/agentAttachments'
import { useRealtimeVoiceInput } from '@/features/conversation/useRealtimeVoiceInput'
import { getFileCategory } from '@/lib/fileType'
import { cn } from '@/lib/utils'

const MAX_FILES = 6
const MAX_FILE_SIZE = 8 * 1024 * 1024
const TEXT_FILE_SIZE = 1.5 * 1024 * 1024
const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/xml',
])

export interface AgentInputPayload {
  content: string
  displayText: string
  attachments: AgentAttachment[]
}

interface AgentInputProps {
  className?: string
  value: string
  onValueChange: (value: string) => void
  onSend: (payload: AgentInputPayload) => void
  onStop?: () => void
  isBusy?: boolean
  compact?: boolean
  variant?: 'default' | 'home'
  modeLabel?: string
  placeholder?: string
}

function isTextFile(file: File) {
  return (
    TEXT_MIME_TYPES.has(file.type) ||
    /\.(txt|md|csv|json|xml|log)$/i.test(file.name)
  )
}

export function AgentInput({
  className,
  value,
  onValueChange,
  onSend,
  onStop,
  isBusy = false,
  compact = false,
  variant = 'default',
  modeLabel = '风险 Agent',
  placeholder = '描述你希望 Agent 完成的风险任务…',
}: AgentInputProps) {
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentsRef = useRef<AgentAttachment[]>([])
  const voice = useRealtimeVoiceInput({ value, onValueChange })

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 96 : 136)}px`
  }, [compact, value])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      })
    },
    []
  )

  const addFiles = async (files: File[]) => {
    setError(null)
    const remaining = MAX_FILES - attachments.length
    if (remaining <= 0) {
      setError(`每轮最多添加 ${MAX_FILES} 个文件`)
      return
    }
    const accepted = files.slice(0, remaining)
    const oversized = accepted.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setError(`${oversized.name} 超过 8 MB，请压缩后重试`)
      return
    }

    setIsReading(true)
    try {
      const next = await Promise.all(
        accepted.map(async (file): Promise<AgentAttachment> => {
          const extractedText =
            isTextFile(file) && file.size <= TEXT_FILE_SIZE
              ? (await file.text()).slice(0, 24_000)
              : undefined
          return {
            id: crypto.randomUUID(),
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            category: getFileCategory(file.name),
            previewUrl: file.type.startsWith('image/')
              ? URL.createObjectURL(file)
              : undefined,
            extractedText,
          }
        })
      )
      setAttachments((current) => [...current, ...next])
    } finally {
      setIsReading(false)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return current.filter((attachment) => attachment.id !== id)
    })
  }

  const submit = () => {
    const displayText = value.trim()
    if (
      (!displayText && attachments.length === 0) ||
      isBusy ||
      isReading ||
      voice.isActive
    ) {
      return
    }
    const fallbackText = displayText || '请分析我提供的附件，并给出可执行的风险方案。'
    onSend({
      displayText: fallbackText,
      content: serializeAgentMessage(fallbackText, attachments),
      attachments,
    })
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    })
    setAttachments([])
    onValueChange('')
    setError(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (voice.isActive) return
      submit()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0
  const isHomeVariant = variant === 'home'

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        data-slot="agent-input"
        onDragEnter={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setIsDragging(false)
          }
        }}
        onDrop={handleDrop}
        data-compact={compact ? 'true' : 'false'}
        data-variant={variant}
        className={cn(
          'relative flex flex-col overflow-hidden',
          isHomeVariant
            ? 'rounded-[26px] border border-border bg-card'
            : 'units-composer-shell',
          isDragging &&
            'border-[var(--units-blue)] ring-4 ring-[color-mix(in_srgb,var(--units-blue)_16%,transparent)]'
        )}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[1.25rem] border-2 border-dashed border-[var(--units-blue)] bg-background/90 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UploadCloud className="size-5 text-[var(--units-blue)]" />
              松开以添加到本轮任务
            </div>
          </div>
        )}

        {!isHomeVariant && (
          <div className="flex min-h-10 items-center gap-2 border-b border-[var(--units-stroke-color)] px-3 py-2">
            <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--units-stroke-color)] bg-[var(--units-green)] px-2.5 text-[11px] font-semibold text-[var(--units-on-accent)]">
              <ShieldCheck className="size-3.5" />
              {modeLabel}
            </span>
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              {compact ? '快速发起保障任务' : '任务输入台'}
            </span>
            <span className="ml-auto shrink-0 text-[10px] font-semibold text-muted-foreground">
              {voice.isActive
                ? voice.statusLabel
                : isReading
                  ? '读取附件…'
                  : attachments.length > 0
                    ? `${attachments.length} 个附件已就绪`
                    : '无附件'}
            </span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="scrollbar-hidden flex gap-2 overflow-x-auto px-3 pt-2.5">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative flex h-14 min-w-44 max-w-56 items-center gap-2.5 rounded-lg border border-[var(--units-stroke-color)] bg-background p-2"
              >
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--units-blue)_12%,transparent)]">
                    <FileText className="size-5 text-[var(--units-blue)]" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">
                    {attachment.fileName}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {attachment.extractedText ? '内容已读取' : formatBytes(attachment.fileSize)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-80 hover:opacity-100"
                  aria-label={`移除 ${attachment.fileName}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          readOnly={voice.isActive}
          rows={1}
          placeholder={placeholder}
          aria-label="任务草稿"
          className={cn(
            'scrollbar-hidden w-full resize-none overflow-y-auto border-0 bg-transparent px-4 pb-2 text-foreground outline-none',
            isHomeVariant
              ? 'max-h-[calc(6*1.625em+1.5rem)] min-h-20 pt-4 text-[15px] leading-relaxed placeholder:text-muted-foreground'
              : 'text-[14px] leading-6 placeholder:text-muted-foreground/70',
            voice.isActive && 'cursor-default',
            !isHomeVariant &&
              (attachments.length > 0
                ? 'min-h-12 pt-2.5'
                : compact
                  ? 'min-h-14 pt-3'
                  : 'min-h-20 pt-3.5')
          )}
        />

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          onChange={handleFileChange}
          className="hidden"
        />

        {isHomeVariant ? (
          <div className="flex items-center gap-2 px-4 pb-4 pt-1">
            <div className="mb-[-5px] ml-[-3px] flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => inputRef.current?.click()}
                disabled={isBusy || isReading}
                className="size-[33px] rounded-full border border-border bg-background text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground"
                aria-label="添加图片或文件"
              >
                {isReading ? (
                  <LoaderCircle className="size-[18px] animate-spin" />
                ) : (
                  <Plus className="size-[18px]" />
                )}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (voice.isActive) {
                    voice.stop()
                  } else {
                    void voice.start()
                  }
                }}
                disabled={
                  (!voice.isActive && (isBusy || isReading)) ||
                  voice.status === 'stopping' ||
                  voice.status === 'unsupported'
                }
                className={cn(
                  'size-[33px] rounded-full border border-border bg-background text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
                  voice.isRecording &&
                    'bg-foreground text-background hover:bg-foreground/90 hover:text-background'
                )}
                aria-label={voice.isActive ? '停止语音输入' : '开始语音输入'}
                aria-pressed={voice.isRecording}
              >
                {voice.status === 'requesting' ||
                voice.status === 'connecting' ||
                voice.status === 'stopping' ? (
                  <LoaderCircle className="size-[18px] animate-spin" />
                ) : voice.isRecording ? (
                  <MicOff className="size-[18px]" />
                ) : (
                  <Mic className="size-[18px]" />
                )}
              </Button>
            </div>
            <div className="mb-[-4px] ml-auto mr-[-4px]">
              <Button
                type="button"
                size="icon"
                onClick={isBusy ? onStop : submit}
                disabled={!isBusy && (voice.isActive || !hasContent || isReading)}
                className={cn(
                  'rounded-full transition-colors',
                  isBusy || (hasContent && !voice.isActive)
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'cursor-default bg-muted text-muted-foreground'
                )}
                aria-label={isBusy ? '停止生成' : '发送任务'}
              >
                {isBusy ? (
                  <Square className="size-3 fill-current" />
                ) : (
                  <ArrowUp className="size-[18px]" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => inputRef.current?.click()}
              disabled={isBusy || isReading}
              className="size-9 rounded-lg border border-[var(--units-stroke-color)] bg-background shadow-none"
              aria-label="添加图片或文件"
            >
              {isReading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => {
                if (voice.isActive) {
                  voice.stop()
                } else {
                  void voice.start()
                }
              }}
              disabled={
                (!voice.isActive && (isBusy || isReading)) ||
                voice.status === 'stopping' ||
                voice.status === 'unsupported'
              }
              className={cn(
                'size-9 rounded-lg border border-[var(--units-stroke-color)] bg-background shadow-none',
                voice.isRecording &&
                  'bg-[var(--units-orange)] text-[var(--units-on-accent)] ring-4 ring-[color-mix(in_srgb,var(--units-orange)_16%,transparent)] hover:bg-[color-mix(in_srgb,var(--units-orange)_88%,var(--units-black))]'
              )}
              aria-label={
                voice.isActive
                  ? voice.status === 'recording'
                    ? '停止语音输入'
                    : '取消语音输入'
                  : '开始语音输入'
              }
              aria-pressed={voice.isRecording}
            >
              {voice.status === 'requesting' ||
              voice.status === 'connecting' ||
              voice.status === 'stopping' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : voice.isRecording ? (
                <MicOff className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {voice.isActive ? voice.statusLabel : '附件 · 粘贴 · 语音输入'}
            </span>
            <Button
              type="button"
              size="icon"
              onClick={isBusy ? onStop : submit}
              disabled={!isBusy && (voice.isActive || !hasContent || isReading)}
              className={cn(
                'ml-auto size-9 rounded-lg border border-[var(--units-stroke-color)] shadow-none',
                isBusy || (hasContent && !voice.isActive)
                  ? 'bg-[var(--units-orange)] text-[var(--units-on-accent)] hover:bg-[color-mix(in_srgb,var(--units-orange)_88%,var(--units-black))]'
                  : 'border-[var(--units-stroke-color)] bg-muted text-muted-foreground'
              )}
              aria-label={
                isBusy
                  ? '停止生成'
                  : voice.isActive
                    ? '请先停止语音输入'
                    : '发送任务'
              }
            >
              {isBusy ? (
                <Square className="size-3 fill-current" />
              ) : (
                <ArrowUp className="size-[17px]" />
              )}
            </Button>
          </div>
        )}
      </div>
      {voice.isActive && (
        <p
          role="status"
          aria-live="polite"
          className="flex min-w-0 items-center gap-2 px-2 text-[11px] font-medium text-muted-foreground"
        >
          <span
            className={cn(
              'size-2 shrink-0 rounded-full border border-[var(--units-stroke-color)]',
              voice.isRecording
                ? 'animate-pulse bg-[var(--units-orange)]'
                : 'bg-[var(--units-yellow)]'
            )}
          />
          <span className="shrink-0">{voice.statusLabel}</span>
          {voice.partialTranscript && (
            <span className="truncate text-foreground">
              临时转录：{voice.partialTranscript}
            </span>
          )}
        </p>
      )}
      {error && <p className="px-2 text-xs text-destructive">{error}</p>}
      {voice.error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {voice.error}
        </p>
      )}
      {attachments.some((attachment) => attachment.category === 'image') && (
        <p className="flex items-center gap-1 px-2 text-[10px] text-muted-foreground">
          <ImageIcon className="size-3" />
          图片可预览；当前模型通道会收到图片元数据，文本类文件会读取内容。
        </p>
      )}
    </div>
  )
}
