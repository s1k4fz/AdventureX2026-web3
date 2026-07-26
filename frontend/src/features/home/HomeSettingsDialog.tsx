import {
  CircleUserRound,
  CreditCard,
  Settings2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Dialog as DialogPrimitive, Tabs as TabsPrimitive } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'

import type { CurrentUser } from '@/features/auth/useCurrentUser'
import { useUnitsMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { HomeSettingsAccountPage } from './HomeSettingsAccountPage'
import { HomeSettingsBillingPage } from './HomeSettingsBillingPage'
import { HomeSettingsGeneralPage } from './HomeSettingsGeneralPage'
import { HomeSettingsWalletPage } from './HomeSettingsWalletPage'

export type HomeSettingsTab = 'general' | 'account' | 'billing' | 'wallet'

interface HomeSettingsTabItem {
  value: HomeSettingsTab
  label: string
  icon: LucideIcon
}

const homeSettingsTabs: HomeSettingsTabItem[] = [
  { value: 'general', label: '通用', icon: Settings2 },
  { value: 'account', label: '账户', icon: CircleUserRound },
  { value: 'billing', label: '订阅', icon: CreditCard },
  { value: 'wallet', label: '钱包', icon: Wallet },
]

interface HomeSettingsDialogProps {
  account: CurrentUser | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: HomeSettingsTab
}

export function HomeSettingsDialog({
  account,
  open,
  onOpenChange,
  defaultTab = 'general',
}: HomeSettingsDialogProps) {
  const close = () => onOpenChange(false)
  const { snap, reduce, scaleFrom } = useUnitsMotion()

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--units-black)_42%,transparent)] backdrop-blur-[1px]"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={snap}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              forceMount
              asChild
              aria-describedby={undefined}
            >
              <motion.div
                className={cn(
                  'fixed left-1/2 top-1/2 z-50 flex h-full w-[calc(100vw-20px)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-[var(--units-brand-plate)] text-foreground shadow-none outline-none',
                  'max-h-[min(720px,82vh)] max-md:min-h-[58vh] md:h-[640px]'
                )}
                initial={reduce ? false : { opacity: 0, scale: scaleFrom, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, scale: scaleFrom, y: 6 }}
                transition={snap}
              >
                <DialogPrimitive.Title className="sr-only">设置</DialogPrimitive.Title>

                <TabsPrimitive.Root
                  key={`${open}-${defaultTab}`}
                  orientation="vertical"
                  defaultValue={defaultTab}
                  className="flex h-full min-h-0 flex-col md:flex-row"
                >
                  <aside className="flex shrink-0 flex-col border-[var(--units-stroke-color)] max-md:border-b md:w-[188px] md:border-r">
                    <div className="flex items-center gap-2 px-3 pb-1 pt-3 md:px-3.5">
                      <DialogPrimitive.Close
                        aria-label="关闭设置"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--units-orange)]"
                      >
                        <X className="size-5" />
                      </DialogPrimitive.Close>
                      <div className="min-w-0 max-md:hidden">
                        <p className="units-text-section text-foreground">设置</p>
                        <p className="units-text-caption text-muted-foreground">
                          xEngine 工作区
                        </p>
                      </div>
                    </div>

                    <TabsPrimitive.List
                      aria-label="设置分类"
                      className="flex gap-1 overflow-x-auto p-2 max-md:items-center md:flex-col md:gap-0.5 md:px-2.5 md:pb-3"
                    >
                      {homeSettingsTabs.map((tab) => {
                        const Icon = tab.icon

                        return (
                          <TabsPrimitive.Trigger
                            key={tab.value}
                            value={tab.value}
                            className={cn(
                              'units-text-body-sm flex items-center gap-2.5 rounded-[var(--units-radius-sm)] px-2.5 py-2 text-left font-medium text-muted-foreground outline-none transition-colors',
                              'hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--units-orange)]',
                              'data-[state=active]:bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] data-[state=active]:text-foreground',
                              'max-md:shrink-0'
                            )}
                          >
                            <Icon className="size-[17px] shrink-0" strokeWidth={1.75} />
                            <span className="min-w-0 grow truncate">{tab.label}</span>
                          </TabsPrimitive.Trigger>
                        )
                      })}
                    </TabsPrimitive.List>
                  </aside>

                  <div className="min-h-0 min-w-0 grow overflow-y-auto px-5 py-5 max-md:px-4">
                    <TabsPrimitive.Content value="general" className="outline-none">
                      <HomeSettingsGeneralPage />
                    </TabsPrimitive.Content>
                    <TabsPrimitive.Content value="account" className="outline-none">
                      <HomeSettingsAccountPage account={account} />
                    </TabsPrimitive.Content>
                    <TabsPrimitive.Content value="billing" className="outline-none">
                      <HomeSettingsBillingPage account={account} />
                    </TabsPrimitive.Content>
                    <TabsPrimitive.Content value="wallet" className="outline-none">
                      <HomeSettingsWalletPage onClose={close} />
                    </TabsPrimitive.Content>
                  </div>
                </TabsPrimitive.Root>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
