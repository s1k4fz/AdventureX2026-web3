import type { CurrentUser } from '@/features/auth/useCurrentUser'
import {
  SettingsMutedValue,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '@/features/home/HomeSettingsPrimitives'

function formatJoinedAt(createdAt: string | undefined) {
  if (!createdAt) return '加载中'
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function HomeSettingsAccountPage({
  account,
}: {
  account: CurrentUser | undefined
}) {
  const color = account?.avatarColor ?? 'var(--units-orange)'
  const label = account?.avatarLabel ?? 'U'

  return (
    <>
      <SettingsPageHeader
        title="账户"
        description="查看当前登录身份。资料由认证账户同步。"
      />

      <div className="space-y-5">
        <div className="rounded-2xl border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] p-4">
          <div className="flex items-center gap-3.5">
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-full border border-[var(--units-stroke-color)]"
              style={{ backgroundColor: color }}
              aria-hidden
            >
              <span className="text-[22px] font-bold leading-none text-white/95">
                {label}
              </span>
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[18px] font-semibold tracking-tight">
                {account?.nickname ?? '加载中'}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                {account?.email ?? '加载中'}
              </p>
            </div>
          </div>
        </div>

        <SettingsSection title="资料">
          <SettingsRow label="昵称">
            <SettingsMutedValue>
              {account?.nickname ?? '加载中'}
            </SettingsMutedValue>
          </SettingsRow>
          <SettingsRow label="邮箱">
            <SettingsMutedValue>
              {account?.email ?? '加载中'}
            </SettingsMutedValue>
          </SettingsRow>
          <SettingsRow label="加入时间">
            <SettingsMutedValue>
              {formatJoinedAt(account?.createdAt)}
            </SettingsMutedValue>
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  )
}
