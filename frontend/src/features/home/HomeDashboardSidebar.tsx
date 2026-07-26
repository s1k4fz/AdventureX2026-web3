import { useMemo } from 'react'
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  Gem,
  MessageSquareText,
  Vault,
} from 'lucide-react'

import { ActionChip } from '@/components/ActionChip'
import { Button } from '@/components/ui/button'
import type { PolicyListItem } from '@/features/policy/policyApi'
import { isCoverageExpired } from '@/features/policy/policyStatus'
import { cn } from '@/lib/utils'

function formatNodeDate(endIso: string) {
  const date = new Date(endIso)
  if (!Number.isFinite(date.getTime())) return endIso.slice(0, 10)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function formatCoverageCountdown(
  endIso: string,
  referenceTimeMs: number
): string | null {
  const endMs = new Date(endIso).getTime()
  if (!Number.isFinite(endMs)) return null

  const diffMs = endMs - referenceTimeMs
  if (diffMs <= 0) return '已到期'

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时`

  const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)))
  return `${minutes} 分钟`
}

interface HomeDashboardSidebarProps {
  policies: PolicyListItem[]
  referenceTimeMs: number
  onNewPolicy: () => void
  onOpenPolicy: (policyId: string) => void
  onViewSchedule: () => void
  onViewVault: () => void
  onViewCollection: () => void
}

export function HomeDashboardSidebar({
  policies,
  referenceTimeMs,
  onNewPolicy,
  onOpenPolicy,
  onViewSchedule,
  onViewVault,
  onViewCollection,
}: HomeDashboardSidebarProps) {
  const upcomingNodes = useMemo(
    () =>
      policies
        .filter(
          (policy) => policy.status === 'active' && Boolean(policy.coverageEnd)
        )
        .sort(
          (a, b) =>
            new Date(a.coverageEnd as string).getTime() -
            new Date(b.coverageEnd as string).getTime()
        )
        .slice(0, 4),
    [policies]
  )

  return (
    <aside className="min-w-0 space-y-2">
      <section className="rounded-md border border-zinc-200/80 bg-zinc-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              下一步行动
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight">
              发起风险任务
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
              用一句话描述担忧，Agent 会继续问卷、检索和方案编排。
            </p>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200/80 bg-[var(--units-yellow)] text-[var(--units-on-accent)]">
            <MessageSquareText className="size-4" />
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onNewPolicy}
          className="mt-3 h-9 w-full rounded-md border border-zinc-200 bg-background text-[12px] font-semibold shadow-none"
        >
          开始风险问卷
          <ArrowRight className="size-3.5" />
        </Button>
      </section>

      <section className="rounded-md border border-zinc-200/80 bg-zinc-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              近期节点
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight">
              保障到期时间线
            </h2>
          </div>
          <Clock3 className="size-4 text-[var(--units-green)]" />
        </div>

        <div className="mt-2.5 space-y-2">
          {upcomingNodes.length > 0 ? (
            upcomingNodes.map((policy) => {
              const endIso = policy.coverageEnd as string
              const expired = isCoverageExpired(endIso, referenceTimeMs)
              const countdown = formatCoverageCountdown(endIso, referenceTimeMs)

              return (
                <button
                  key={policy.id}
                  type="button"
                  onClick={() => onOpenPolicy(policy.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2 text-left transition-colors',
                    expired
                      ? 'border-[color-mix(in_srgb,var(--units-orange)_38%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_9%,transparent)] hover:border-[var(--units-orange)]'
                      : 'border-border hover:bg-zinc-100/60'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200/80 text-[11px] font-bold',
                      expired
                        ? 'bg-[var(--units-orange)] text-[var(--units-on-accent)]'
                        : 'bg-[var(--units-green)] text-white'
                    )}
                  >
                    {expired ? <CircleAlert className="size-4" /> : formatNodeDate(endIso)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold">
                      {policy.title || '未命名保单'}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block text-[11px]',
                        expired
                          ? 'font-semibold text-[var(--units-orange)]'
                          : 'text-muted-foreground'
                      )}
                    >
                      {expired ? '已到期 · 待结算' : `剩余 ${countdown}`}
                    </span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              )
            })
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center">
              <p className="text-[12.5px] font-medium">暂无生效中的到期节点</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                保单生效后会在这里按到期日排列
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onViewSchedule}
          className="mt-3 flex w-full items-center justify-between text-[12px] font-semibold text-[var(--units-orange)] hover:underline"
        >
          查看完整结算日程
          <ArrowRight className="size-3.5" />
        </button>
      </section>

      <section className="rounded-md border border-zinc-200/80 bg-zinc-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          快捷入口
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionChip
            icon={CalendarDays}
            iconColor="var(--units-green)"
            label="结算日程"
            onClick={onViewSchedule}
          />
          <ActionChip
            icon={Vault}
            iconColor="var(--units-lilac)"
            label="链上金库"
            onClick={onViewVault}
          />
          <ActionChip
            icon={Gem}
            iconColor="var(--units-orange)"
            label="NFT 藏品"
            onClick={onViewCollection}
          />
        </div>
      </section>
    </aside>
  )
}
