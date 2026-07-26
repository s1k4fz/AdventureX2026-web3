import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CreditCard, LogOut, Settings2, UserRound, Wallet } from 'lucide-react'

import {
  ActionMenu,
  ActionMenuItem,
  ActionMenuSeparator,
} from '@/components/ActionMenu'
import { UserAvatar } from '@/components/UserAvatar'
import {
  HomeSettingsDialog,
  type HomeSettingsTab,
} from '@/features/home/HomeSettingsDialog'
import {
  currentUserQueryKey,
  useCurrentUser,
} from '@/features/auth/useCurrentUser'
import { useAuth } from '@/features/auth/useAuth'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

export function HomeUserMenu() {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: currentUser } = useCurrentUser()
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<HomeSettingsTab>('general')

  const fallbackEmail = session?.user.email ?? ''
  const fallbackNickname = fallbackEmail.split('@')[0] || '用户'
  const displayNickname = currentUser?.nickname ?? fallbackNickname
  const displayEmail = currentUser?.email ?? fallbackEmail
  const displayColor = currentUser?.avatarColor ?? '#71717a'
  const displayAvatarLabel =
    currentUser?.avatarLabel ??
    Array.from(fallbackNickname)[0]?.toUpperCase() ??
    'U'
  const plan = currentUser?.subscriptionPlan
  const isPro = plan === 'Pro'

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Failed to sign out', error)
      return
    }

    queryClient.removeQueries({ queryKey: currentUserQueryKey })
  }

  const openSettings = (tab: HomeSettingsTab) => {
    setSettingsTab(tab)
    setSettingsDialogOpen(true)
  }

  return (
    <>
      <ActionMenu
        align="end"
        side="bottom"
        sideOffset={10}
        width="lg"
        contentClassName={cn(
          'w-[272px] rounded-2xl border border-zinc-200',
          'bg-white p-1.5 shadow-none'
        )}
        trigger={
          <UserAvatar
            name={displayNickname}
            color={displayColor}
            aria-label="打开账户菜单"
            className="ms-0.5 rounded-full outline-none transition-[box-shadow,transform] hover:ring-2 hover:ring-zinc-300 data-[state=open]:scale-[0.96] data-[state=open]:ring-2 data-[state=open]:ring-zinc-300"
          />
        }
      >
        <div className="mb-1 rounded-xl bg-zinc-50 px-2.5 py-3">
          <div className="flex items-start gap-2.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-zinc-200"
              style={{ backgroundColor: displayColor }}
              aria-hidden
            >
              <span className="text-[15px] font-bold leading-none text-white/95">
                {displayAvatarLabel}
              </span>
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-[14px] font-semibold leading-5 tracking-tight">
                  {displayNickname}
                </p>
                {plan ? (
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-4 tracking-wide',
                      isPro
                        ? 'border-zinc-300 bg-zinc-100 text-zinc-700'
                        : 'border-zinc-200 bg-background/70 text-muted-foreground'
                    )}
                  >
                    {plan}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[12px] leading-4 text-muted-foreground">
                {displayEmail || '加载中…'}
              </p>
            </div>
          </div>
        </div>

        <ActionMenuItem
          label="账户"
          icon={UserRound}
          onSelect={() => openSettings('account')}
        />
        <ActionMenuItem
          label="订阅"
          icon={CreditCard}
          onSelect={() => openSettings('billing')}
        />
        <ActionMenuItem
          label="钱包"
          icon={Wallet}
          onSelect={() => openSettings('wallet')}
        />
        <ActionMenuItem
          label="设置"
          icon={Settings2}
          onSelect={() => openSettings('general')}
        />

        <ActionMenuSeparator />

        <ActionMenuItem
          label="退出登录"
          icon={LogOut}
          destructive
          onSelect={() => void handleSignOut()}
        />
      </ActionMenu>

      <HomeSettingsDialog
        account={currentUser}
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        defaultTab={settingsTab}
      />
    </>
  )
}
