import { useState, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HOME_PLUS_LEFT_OFFSET_CLASS = 'ml-[-3px]'
const HOME_PLUS_BOTTOM_OFFSET_CLASS = 'mb-[-5px]'

export function ChatInput({
  className,
  onSend,
}: {
  className?: string
  onSend: (text: string, options?: { tool?: 'policy_planning' }) => void
}) {
  const [value, setValue] = useState('')
  const hasContent = value.trim().length > 0

  const submit = () => {
    const text = value.trim()
    if (!text) {
      return
    }
    onSend(text, { tool: 'policy_planning' })
    setValue('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-[26px] border border-zinc-200 bg-white',
        className
      )}
    >
      <textarea
        placeholder="描述你的保障诉求，xEngine 将为你规划方案…"
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="scrollbar-hidden max-h-[calc(6*1.625em+1.5rem)] min-h-20 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400"
        style={{ fieldSizing: 'content' } as React.CSSProperties}
      />

      <div className="flex items-center gap-2 px-4 pt-1 pb-4">
        <div
          className={cn(
            HOME_PLUS_BOTTOM_OFFSET_CLASS,
            HOME_PLUS_LEFT_OFFSET_CLASS,
            'flex items-center gap-2'
          )}
        >
          <span className="inline-flex h-[28px] items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-[12px] font-medium text-zinc-700">
            <img src="/logo.svg" alt="" className="size-3.5 rounded-[3px]" />
            xEngine
          </span>
        </div>

        <div className="mb-[-4px] ml-auto mr-[-4px]">
          <Button
            type="button"
            variant="default"
            size="icon"
            disabled={!hasContent}
            onClick={submit}
            className={cn(
              'rounded-full transition-colors',
              hasContent
                ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                : 'cursor-default bg-zinc-200 text-zinc-400'
            )}
            aria-label="发送消息"
          >
            <ArrowUp className="size-[18px]" />
          </Button>
        </div>
      </div>
    </div>
  )
}
