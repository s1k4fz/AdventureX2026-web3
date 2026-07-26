import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { ArrowUpRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { PolicyStatusBadge } from '@/features/policy/PolicyStatusBadge'
import { TxLink } from '@/features/wallet/TxLink'
import { cn } from '@/lib/utils'
import type { ScheduleEvent } from './types'
import { KIND_DOT } from './scheduleKindStyles'

interface ScheduleEventDetailSheetProps {
  event: ScheduleEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEditWatchItem?: (watchItemId: string) => void
}

export function ScheduleEventDetailSheet({
  event,
  open,
  onOpenChange,
  onEditWatchItem,
}: ScheduleEventDetailSheetProps) {
  const navigate = useNavigate()

  const actions =
    event?.actions && event.actions.length > 0
      ? event.actions
      : event?.href
        ? [
            {
              label: event.nextActionLabel ?? '打开',
              href: event.href,
              primary: true,
            },
          ]
        : []

  const go = (href: string) => {
    if (/^https?:\/\//i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    navigate(href)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        {event ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2.5 rounded-full',
                    KIND_DOT[event.kind] ?? 'bg-muted-foreground'
                  )}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {event.kindLabel ?? event.kind}
                </span>
                {event.countdown ? (
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                      event.countdown === '已到期'
                        ? 'border-[var(--units-orange)] text-[var(--units-orange)]'
                        : 'border-[var(--units-stroke-color)] text-muted-foreground'
                    )}
                  >
                    {event.countdown === '已到期'
                      ? '已到期 · 待结算'
                      : `剩余 ${event.countdown}`}
                  </span>
                ) : null}
              </div>
              <SheetTitle className="font-display text-left text-xl leading-snug">
                {event.title}
              </SheetTitle>
              <SheetDescription className="text-left">
                {format(parseISO(event.date), 'yyyy年M月d日 EEEE', {
                  locale: zhCN,
                })}
                {event.subtitle ? ` · ${event.subtitle}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 px-4">
              {event.status ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">状态</span>
                  <PolicyStatusBadge status={event.status} />
                </div>
              ) : null}

              {event.goalSnippet ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    任务描述
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-foreground">
                    {event.goalSnippet}
                  </p>
                </div>
              ) : null}

              {event.healthHint ? (
                <p className="rounded-xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] px-3 py-2 text-[12.5px] leading-5 text-foreground">
                  {event.healthHint}
                </p>
              ) : null}

              {(event.premiumLabel || event.payoutLabel || event.tierLabel) && (
                <div className="flex flex-wrap gap-1.5">
                  {event.tierLabel ? (
                    <span className="rounded-full border border-[var(--units-stroke-color)] px-2.5 py-1 text-[11px]">
                      {event.tierLabel}
                    </span>
                  ) : null}
                  {event.premiumLabel ? (
                    <span className="rounded-full border border-[var(--units-stroke-color)] px-2.5 py-1 text-[11px]">
                      {event.premiumLabel}
                    </span>
                  ) : null}
                  {event.payoutLabel ? (
                    <span className="rounded-full border border-[var(--units-stroke-color)] px-2.5 py-1 text-[11px]">
                      {event.payoutLabel}
                    </span>
                  ) : null}
                </div>
              )}

              {event.meta && event.meta.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {event.meta.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--units-stroke-color)] px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}

              {event.txHash ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>开保交易</span>
                  <TxLink hash={event.txHash} />
                </div>
              ) : null}

              <p className="text-[12.5px] leading-5 text-muted-foreground">
                {event.kind === 'custom'
                  ? '自定义关注事项。可编辑内容，或通过下方链接继续操作。'
                  : '全日保障节点。可从下方进入保单、Agent 任务或金库继续操作。'}
              </p>
            </div>

            <SheetFooter className="gap-2 sm:flex-col">
              {event.kind === 'custom' &&
              event.watchItemId &&
              onEditWatchItem ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    onOpenChange(false)
                    onEditWatchItem(event.watchItemId!)
                  }}
                >
                  编辑关注事项
                </Button>
              ) : null}
              {actions.length > 0 ? (
                actions.map((action) => (
                  <Button
                    key={`${action.label}-${action.href}`}
                    variant={action.primary ? 'default' : 'outline'}
                    className="w-full gap-1.5"
                    onClick={() => {
                      onOpenChange(false)
                      go(action.href)
                    }}
                  >
                    {action.label}
                    <ArrowUpRight className="size-4" />
                  </Button>
                ))
              ) : event.kind !== 'custom' ? (
                <p className="text-center text-xs text-muted-foreground">
                  演示节点，无关联保单
                </p>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
