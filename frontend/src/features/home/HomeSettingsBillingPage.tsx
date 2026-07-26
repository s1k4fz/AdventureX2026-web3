import { BadgeCheck } from 'lucide-react'

import type {
  CurrentUser,
  DisplaySubscriptionPlan,
} from '@/features/auth/useCurrentUser'
import {
  SettingsMutedValue,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '@/features/home/HomeSettingsPrimitives'
import { cn } from '@/lib/utils'

function PlanBadge({ plan }: { plan: DisplaySubscriptionPlan }) {
  const isPro = plan === 'Pro'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        isPro
          ? 'border-[color-mix(in_srgb,var(--units-orange)_40%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_14%,transparent)] text-[var(--units-orange)]'
          : 'border-[var(--units-stroke-color)] bg-background text-muted-foreground'
      )}
    >
      {isPro ? <BadgeCheck className="size-3.5" strokeWidth={2} /> : null}
      {plan}
    </span>
  )
}

export function HomeSettingsBillingPage({
  account,
}: {
  account: CurrentUser | undefined
}) {
  const isPro = account?.subscriptionPlan === 'Pro'
  const quotaItems = [
    {
      label: '并发保单',
      hint: '同时处于保障期的保单上限',
      value: account ? (isPro ? '无限制' : '3 份') : '加载中',
    },
    {
      label: 'Agent 任务',
      hint: '每日可发起的规划对话次数',
      value: account ? (isPro ? '无限制' : '每日 20 次') : '加载中',
    },
    {
      label: 'Credits',
      hint: '用于检索与方案生成的额度',
      value: account ? (isPro ? '3000 / 日' : '300 / 日') : '加载中',
    },
  ]

  return (
    <>
      <SettingsPageHeader
        title="订阅与额度"
        description="查看当前方案与 xEngine 任务额度。"
      />

      <div className="space-y-5">
        <SettingsSection title="当前方案">
          <SettingsRow label="订阅" hint="账户绑定的产品方案">
            {account ? (
              <PlanBadge plan={account.subscriptionPlan} />
            ) : (
              <SettingsMutedValue>加载中</SettingsMutedValue>
            )}
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="额度"
          description="额度随方案变化；升级后将自动提高上限。"
        >
          {quotaItems.map((item) => (
            <SettingsRow key={item.label} label={item.label} hint={item.hint}>
              <SettingsMutedValue>{item.value}</SettingsMutedValue>
            </SettingsRow>
          ))}
        </SettingsSection>

        {!isPro && account ? (
          <div className="rounded-2xl border border-[var(--units-stroke-color)] bg-[var(--units-orange)] px-4 py-3.5 text-[var(--units-on-accent)]">
            <p className="font-display text-[15px] font-semibold tracking-tight">
              需要更高额度？
            </p>
            <p className="mt-1 text-[12.5px] leading-5 opacity-90">
              Pro 开放无限并发保单与更高每日 Credits，适合持续跟踪多份风险敞口。
            </p>
          </div>
        ) : null}
      </div>
    </>
  )
}
