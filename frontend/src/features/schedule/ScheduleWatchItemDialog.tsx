import { type FormEvent, useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Info, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  usePoliciesQuery,
  type PolicyListItem,
} from '@/features/policy/policyApi'
import { POLICY_STATUS_LABELS } from '@/features/policy/policyStatus'
import { cn } from '@/lib/utils'
import {
  useCreateScheduleWatchItemMutation,
  useUpdateScheduleWatchItemMutation,
  type ScheduleWatchItem,
  type ScheduleWatchItemColor,
} from './watchItemsApi'

const COLOR_OPTIONS: Array<{
  value: ScheduleWatchItemColor
  label: string
  swatch: string
}> = [
  { value: 'blue', label: '蓝', swatch: 'bg-[var(--units-blue)]' },
  { value: 'lilac', label: '紫', swatch: 'bg-[var(--units-lilac)]' },
  { value: 'orange', label: '橙', swatch: 'bg-[var(--units-orange)]' },
  { value: 'green', label: '绿', swatch: 'bg-[var(--units-green)]' },
  { value: 'yellow', label: '黄', swatch: 'bg-[var(--units-yellow)]' },
  { value: 'red', label: '红', swatch: 'bg-[var(--units-red)]' },
]

const NONE_POLICY = '__none__'

function isWatchColor(value: string): value is ScheduleWatchItemColor {
  return COLOR_OPTIONS.some((option) => option.value === value)
}

function policyPath(policyId: string) {
  return `/policy/${policyId}`
}

function coverageDueOn(policy: PolicyListItem): string {
  if (!policy.coverageEnd) return ''
  return policy.coverageEnd.slice(0, 10)
}

function policyOptionLabel(policy: PolicyListItem) {
  const status = POLICY_STATUS_LABELS[policy.status] ?? policy.status
  return `${policy.title} · ${status}`
}

export function ScheduleWatchItemDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing?: ScheduleWatchItem | null
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [href, setHref] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [color, setColor] = useState<ScheduleWatchItemColor>('blue')
  const inputRef = useRef<HTMLInputElement>(null)

  const policiesQuery = usePoliciesQuery({ enabled: open })
  const policies = policiesQuery.data ?? []

  const createMutation = useCreateScheduleWatchItemMutation()
  const updateMutation = useUpdateScheduleWatchItemMutation()
  const isEditing = Boolean(editing)
  const pending = createMutation.isPending || updateMutation.isPending
  const failed = createMutation.isError || updateMutation.isError

  useEffect(() => {
    if (!open) return
    if (editing) {
      setTitle(editing.title)
      setNotes(editing.notes ?? '')
      setDueOn(editing.dueOn ?? '')
      setHref(editing.href ?? '')
      setPolicyId(editing.policyId ?? '')
      setColor(isWatchColor(editing.color) ? editing.color : 'blue')
    } else {
      setTitle('')
      setNotes('')
      setDueOn('')
      setHref('')
      setPolicyId('')
      setColor('blue')
    }
    createMutation.reset()
    updateMutation.reset()
    // Only sync form when the dialog opens or the edit target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      createMutation.reset()
      updateMutation.reset()
    }
    onOpenChange(nextOpen)
  }

  const handlePolicyChange = (value: string) => {
    if (value === NONE_POLICY) {
      setPolicyId('')
      return
    }

    const previous = policies.find((policy) => policy.id === policyId)
    const next = policies.find((policy) => policy.id === value)
    if (!next) return

    setPolicyId(next.id)

    const nextHref = policyPath(next.id)
    const previousHref = previous ? policyPath(previous.id) : null
    if (!href.trim() || href === previousHref) {
      setHref(nextHref)
    }

    if (!title.trim() || (previous && title === previous.title)) {
      setTitle(next.title.slice(0, 120))
    }

    const nextDue = coverageDueOn(next)
    const previousDue = previous ? coverageDueOn(previous) : ''
    if (nextDue && (!dueOn.trim() || dueOn === previousDue)) {
      setDueOn(nextDue)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || pending) return

    const notesValue = notes.trim() || null
    const dueValue = dueOn.trim() || null
    const hrefValue =
      href.trim() || (policyId ? policyPath(policyId) : null)

    if (editing) {
      updateMutation.mutate(
        {
          itemId: editing.id,
          title: trimmedTitle,
          notes: notesValue,
          color,
          ...(dueValue
            ? { dueOn: dueValue, clearDueOn: false }
            : { clearDueOn: true }),
          ...(hrefValue
            ? { href: hrefValue, clearHref: false }
            : { clearHref: true }),
          ...(policyId
            ? { policyId, clearPolicyId: false }
            : { clearPolicyId: true }),
        },
        {
          onSuccess: () => onOpenChange(false),
        }
      )
      return
    }

    createMutation.mutate(
      {
        title: trimmedTitle,
        notes: notesValue,
        dueOn: dueValue,
        href: hrefValue,
        policyId: policyId || null,
        color,
      },
      {
        onSuccess: () => onOpenChange(false),
      }
    )
  }

  const isSubmitDisabled = title.trim().length === 0 || pending
  const selectedPolicyMissing =
    Boolean(policyId) &&
    policiesQuery.isSuccess &&
    !policies.some((policy) => policy.id === policyId)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-background shadow-xl outline-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
          )}
        >
          <div className="flex min-h-14 items-start gap-2 p-2 ps-4">
            <div className="mt-1 flex max-w-[calc(100%-100px)] flex-col">
              <DialogPrimitive.Title className="text-lg font-normal text-foreground">
                {isEditing ? '编辑关注事项' : '添加关注事项'}
              </DialogPrimitive.Title>
            </div>
            <div className="grow" />
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭"
                className="rounded-full"
              >
                <X className="size-5" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-3 px-4 pt-1">
              <div>
                <label
                  htmlFor="watch-policy"
                  className="mb-2 block text-sm text-foreground"
                >
                  关联保单（可选）
                </label>
                <Select
                  value={policyId || NONE_POLICY}
                  onValueChange={handlePolicyChange}
                  disabled={policiesQuery.isLoading}
                >
                  <SelectTrigger
                    id="watch-policy"
                    className="h-10 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm shadow-none"
                  >
                    <SelectValue
                      placeholder={
                        policiesQuery.isLoading
                          ? '加载保单中…'
                          : '不关联保单'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[60] max-h-72">
                    <SelectItem value={NONE_POLICY}>不关联保单</SelectItem>
                    {selectedPolicyMissing ? (
                      <SelectItem value={policyId}>
                        已关联保单（当前列表不可见）
                      </SelectItem>
                    ) : null}
                    {policies.map((policy) => (
                      <SelectItem key={policy.id} value={policy.id}>
                        {policyOptionLabel(policy)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {policiesQuery.isError ? (
                  <p className="mt-1.5 text-xs text-destructive">
                    保单列表加载失败，仍可手动填写关注
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="watch-title"
                  className="mb-2 block text-sm text-foreground"
                >
                  标题
                </label>
                <div className="grid grid-cols-[auto_minmax(0,1fr)]">
                  <input
                    ref={inputRef}
                    id="watch-title"
                    name="title"
                    type="text"
                    autoComplete="off"
                    maxLength={120}
                    placeholder="例如：复核结算窗口 / 关注某市场到期"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="col-span-full row-1 h-10 w-full rounded-md border border-zinc-200 bg-background px-3 pe-3 ps-11 text-sm text-foreground outline-none placeholder:text-zinc-400"
                  />
                  <span className="col-1 row-1 flex size-10 items-center justify-center text-muted-foreground">
                    <BookmarkPlus className="size-5" />
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="watch-notes"
                  className="mb-2 block text-sm text-foreground"
                >
                  备注（可选）
                </label>
                <textarea
                  id="watch-notes"
                  name="notes"
                  rows={2}
                  maxLength={2000}
                  placeholder="补充上下文，方便之后回顾"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="w-full resize-none rounded-md border border-zinc-200 bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-zinc-400"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="watch-due"
                    className="mb-2 block text-sm text-foreground"
                  >
                    日期（可选）
                  </label>
                  <input
                    id="watch-due"
                    name="dueOn"
                    type="date"
                    value={dueOn}
                    onChange={(event) => setDueOn(event.target.value)}
                    className="h-10 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm text-foreground outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="watch-href"
                    className="mb-2 block text-sm text-foreground"
                  >
                    链接（可选）
                  </label>
                  <input
                    id="watch-href"
                    name="href"
                    type="text"
                    autoComplete="off"
                    maxLength={500}
                    placeholder="/policy/… 或 https://"
                    value={href}
                    onChange={(event) => setHref(event.target.value)}
                    className="h-10 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm text-foreground outline-none placeholder:text-zinc-400"
                  />
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm text-foreground">颜色</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={color === option.value}
                      onClick={() => setColor(option.value)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full border transition-colors',
                        color === option.value
                          ? 'border-foreground'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      )}
                    >
                      <span
                        className={cn('size-5 rounded-full', option.swatch)}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <aside className="mt-1 flex items-center rounded-lg bg-muted p-3">
                <div className="me-2 flex size-6 items-center justify-center text-muted-foreground">
                  <Info className="size-5" />
                </div>
                <p className="text-pretty text-xs text-muted-foreground">
                  可先选择保单自动填入标题与详情链接；自定义关注会出现在左侧「关注事项」，填写日期后还会钉到右侧日历。
                </p>
              </aside>

              {failed ? (
                <p className="text-xs text-destructive">
                  {isEditing ? '保存失败，请重试' : '添加失败，请重试'}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end px-3 pb-3 pt-4">
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitDisabled}
                className="rounded-full"
              >
                {pending
                  ? isEditing
                    ? '保存中…'
                    : '添加中…'
                  : isEditing
                    ? '保存'
                    : '添加关注'}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
