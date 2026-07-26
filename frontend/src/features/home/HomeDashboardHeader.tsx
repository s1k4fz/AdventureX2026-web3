import {
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'

import { DitherBackground } from '@/components/backgrounds/DitherBackground'
import { HomeUserMenu } from '@/features/home/HomeUserMenu'
import { WalletConnectButton } from '@/features/wallet/WalletConnectButton'
import { useWallet } from '@/features/wallet/useWallet'
import { cn } from '@/lib/utils'

interface HomeDashboardHeaderProps {
  greeting: string
  nickname?: string | null
  pendingSettleCount: number
}

export function HomeDashboardHeader({
  greeting,
  nickname,
  pendingSettleCount,
}: HomeDashboardHeaderProps) {
  const wallet = useWallet()

  const statusLabel = wallet.isConnected
    ? '钱包已就绪'
    : wallet.isWrongNetwork
      ? '网络待切换'
      : wallet.status === 'connecting'
        ? '连接中…'
        : '未连接钱包'

  const StatusIcon = wallet.isConnected
    ? CheckCircle2
    : wallet.isWrongNetwork
      ? CircleAlert
      : WalletCards

  return (
    <header className="relative shrink-0 overflow-hidden border-b border-[var(--units-stroke-color)] px-4 py-4 sm:px-5">
      <DitherBackground
        variant={pendingSettleCount > 0 ? 'active' : 'calm'}
        opacity={0.26}
        className="[mask-image:linear-gradient(to_bottom,black_35%,transparent)]"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-orange)] text-[var(--units-on-accent)]">
              <ShieldCheck className="size-4" strokeWidth={2.2} />
            </span>
            <p className="units-text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {greeting}
              {nickname ? `，${nickname}` : ''} · Injective 承保工作台
            </p>
          </div>
          <h1 className="units-text-title mt-1.5 text-foreground">
            保障看板
          </h1>
          <p className="units-text-body-sm mt-1 max-w-xl text-muted-foreground">
            {pendingSettleCount > 0
              ? `${pendingSettleCount} 份保障已到期，优先核对待结算结果；其余保障和下一步任务可在同一工作台继续处理。`
              : '集中查看生效保障、待办方案与近期结算节点，并从下一步行动直接发起新的风险任务。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold',
              wallet.isConnected
                ? 'border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_12%,transparent)] text-[var(--units-green)]'
                : wallet.isWrongNetwork
                  ? 'border-[color-mix(in_srgb,var(--units-orange)_35%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] text-[var(--units-orange)]'
                  : 'border-border bg-background/80 text-muted-foreground'
            )}
          >
            <StatusIcon className="size-3.5" />
            {statusLabel}
          </span>
          <WalletConnectButton className="h-8 bg-background/85 px-3 text-[11px] backdrop-blur-sm" />
          <HomeUserMenu />
        </div>
      </div>
    </header>
  )
}
