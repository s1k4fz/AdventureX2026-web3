import { useState } from 'react'
import { ArrowUpRight, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  NEED_TEXT_MAX,
  NEED_TEXT_WARN,
  clampNeedTextInput,
  sanitizeNeedText,
} from '@/lib/validators'
import { cn } from '@/lib/utils'

import {
  BUDGET_OPTIONS,
  EMPTY_PREFERENCES,
  HORIZON_OPTIONS,
  POLICY_TEMPLATES,
  RISK_OPTIONS,
  buildGoalText,
  type PolicyCreatePreferences,
} from './goalText'

function PreferenceChip({
  label,
  selected,
  disabled,
  onToggle,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-150',
        disabled && 'cursor-not-allowed opacity-60',
        selected
          ? 'border-[var(--units-orange)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] text-foreground'
          : 'border-[var(--units-stroke-color)] bg-background text-muted-foreground hover:border-[var(--units-stroke-strong)] hover:text-foreground'
      )}
    >
      {selected ? (
        <Check className="size-3 text-[var(--units-orange)]" strokeWidth={3} />
      ) : null}
      {label}
    </button>
  )
}

/**
 * 三组结构化快捷字段（期限 / 预算 / 风险），单选可反选。
 * 也被任务工作台的「调整需求」面板复用。
 */
export function PreferenceChipGroups({
  preferences,
  onChange,
  disabled,
}: {
  preferences: PolicyCreatePreferences
  onChange: (next: PolicyCreatePreferences) => void
  disabled?: boolean
}) {
  const groups: Array<{
    key: keyof PolicyCreatePreferences
    label: string
    options: readonly string[]
  }> = [
    { key: 'horizon', label: '保障期限', options: HORIZON_OPTIONS },
    { key: 'budget', label: '保费预算', options: BUDGET_OPTIONS },
    { key: 'risk', label: '风险偏好', options: RISK_OPTIONS },
  ]

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1.5">
          <p className="text-[12px] font-semibold text-muted-foreground">
            {group.label}
            <span className="ml-1.5 font-normal text-muted-foreground/60">
              选填
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.options.map((option) => (
              <PreferenceChip
                key={option}
                label={option}
                disabled={disabled}
                selected={preferences[group.key] === option}
                onToggle={() =>
                  onChange({
                    ...preferences,
                    [group.key]:
                      preferences[group.key] === option ? null : option,
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface PolicyCreateSubmitPayload {
  goalText: string
  displayText: string
}

/**
 * 工作台式保单创建表单：需求描述 + 结构化快捷字段 + 场景模板。
 * 表单值拼装为自然语言 goalText 后走既有 POST /agent-tasks，后端不变。
 */
export function PolicyCreateForm({
  initialNeedText = '',
  isSubmitting = false,
  errorMessage,
  onSubmit,
  onNeedTextChange,
}: {
  initialNeedText?: string
  isSubmitting?: boolean
  errorMessage?: string | null
  onSubmit: (payload: PolicyCreateSubmitPayload) => void
  /** 草稿变化回调（页面用于 sessionStorage 持久化）。 */
  onNeedTextChange?: (text: string) => void
}) {
  const [needText, setNeedText] = useState(initialNeedText)
  const [preferences, setPreferences] =
    useState<PolicyCreatePreferences>(EMPTY_PREFERENCES)

  const updateNeedText = (raw: string) => {
    // 粘贴超长 / 控制字符在输入期即清洗，不等到提交才报错。
    const next = clampNeedTextInput(raw)
    setNeedText(next)
    onNeedTextChange?.(next)
  }

  const canSubmit = sanitizeNeedText(needText).length > 0 && !isSubmitting

  const handleSubmit = () => {
    if (!canSubmit) return
    const cleaned = sanitizeNeedText(needText)
    onSubmit({
      goalText: buildGoalText(cleaned, preferences),
      displayText: cleaned,
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor="policy-need-text"
            className="text-[12px] font-semibold text-muted-foreground"
          >
            保障需求描述
          </label>
          <span
            className={cn(
              'text-[11px] tabular-nums',
              needText.length >= NEED_TEXT_WARN
                ? 'font-semibold text-[var(--units-orange)]'
                : 'text-muted-foreground/70'
            )}
          >
            {needText.length} / {NEED_TEXT_MAX}
          </span>
        </div>
        <Textarea
          id="policy-need-text"
          value={needText}
          disabled={isSubmitting}
          maxLength={NEED_TEXT_MAX}
          onChange={(event) => updateNeedText(event.target.value)}
          placeholder="描述你担心的风险，例如：担心美联储降息预期落空…"
          className="min-h-[104px] resize-none rounded-xl border-[var(--units-stroke-color)] bg-background px-3.5 py-3 text-[14px] leading-6"
        />
      </div>

      <PreferenceChipGroups
        preferences={preferences}
        onChange={setPreferences}
        disabled={isSubmitting}
      />

      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] font-semibold text-muted-foreground">
          常见场景模板
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {POLICY_TEMPLATES.map((template) => (
            <button
              key={template.title}
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                updateNeedText(template.needText)
                setPreferences(template.preferences)
              }}
              className="group flex items-start gap-2.5 rounded-xl bg-[var(--units-wash-strong)] px-3.5 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--units-black)_7%,transparent)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-[var(--units-orange)]">
                  {template.title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-5">
                  {template.needText}
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </button>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-xl bg-[color-mix(in_srgb,var(--units-red)_10%,transparent)] px-3 py-2 text-sm text-[var(--units-red)]"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <p className="text-[12px] text-muted-foreground">
          创建后进入工作台：问卷 → 检索市场 → 三档方案
        </p>
        <Button
          type="submit"
          disabled={!canSubmit}
          className="h-[38px] rounded-full bg-zinc-950 px-5 text-[14px] font-normal text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? <Spinner className="size-4" /> : null}
          创建保障任务
        </Button>
      </div>
    </form>
  )
}
