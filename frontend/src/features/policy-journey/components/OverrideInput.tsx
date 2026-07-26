import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export interface OverrideInputProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  isPending?: boolean
}

export function OverrideInput({
  onSubmit,
  disabled,
  isPending,
}: OverrideInputProps) {
  const [text, setText] = useState('')

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || isPending) return
    onSubmit(trimmed)
  }

  return (
    <div className="rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-soft)] p-4">
      <label
        htmlFor="policy-override-input"
        className="mb-2.5 block font-display text-[14px] font-semibold text-foreground"
      >
        调整诉求
      </label>
      <textarea
        id="policy-override-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled || isPending}
        placeholder="例如：更偏向稳健档，缩短保障窗口，降低单点暴露…"
        rows={3}
        className={cn(
          'w-full resize-y rounded-lg border border-[var(--units-stroke-color)] bg-background px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--units-orange)_35%,transparent)]',
          'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'
        )}
      />
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          disabled={disabled || isPending || text.trim().length === 0}
          onClick={handleSubmit}
          className="h-9 rounded-lg border border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] px-4 text-[13px] font-medium text-foreground hover:bg-[color-mix(in_srgb,var(--units-orange)_22%,transparent)] motion-reduce:transition-none"
        >
          {isPending ? <Spinner className="mr-1.5 size-3.5" /> : null}
          按新诉求重推
        </Button>
      </div>
    </div>
  )
}
