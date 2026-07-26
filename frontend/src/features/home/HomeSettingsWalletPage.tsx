import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  WalletCards,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  SettingsMutedValue,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '@/features/home/HomeSettingsPrimitives'
import { CopyableAddress } from '@/features/wallet/CopyableAddress'
import { useWallet } from '@/features/wallet/useWallet'
import { cn } from '@/lib/utils'

export function HomeSettingsWalletPage({
  onClose,
}: {
  onClose?: () => void
}) {
  const wallet = useWallet()

  const statusLabel = wallet.isConnected
    ? '钱包已就绪'
    : wallet.isWrongNetwork
      ? '网络待切换'
      : wallet.status === 'connecting'
        ? '连接中…'
        : wallet.isWalletConnected
          ? '钱包已连接'
          : '未连接钱包'

  const StatusIcon = wallet.isConnected
    ? CheckCircle2
    : wallet.isWrongNetwork
      ? CircleAlert
      : wallet.status === 'connecting'
        ? LoaderCircle
        : WalletCards

  const statusColor = wallet.isConnected
    ? 'text-[var(--units-green)]'
    : wallet.isWrongNetwork
      ? 'text-[var(--units-orange)]'
      : 'text-muted-foreground'

  return (
    <>
      <SettingsPageHeader
        title="钱包与链"
        description="出资前确认已连接并切到 Injective 测试网。"
      />

      <div className="space-y-5">
        <div className="flex items-start gap-2.5">
          <StatusIcon
            className={cn(
              'mt-0.5 size-[18px] shrink-0',
              statusColor,
              wallet.status === 'connecting' && 'animate-spin'
            )}
          />
          <div>
            <p className="text-[15px] font-semibold leading-5">{statusLabel}</p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
              {wallet.isConnected
                ? '可以签名并完成出资等链上操作。'
                : wallet.isWrongNetwork
                  ? '请切换到 Injective 测试网后再继续。'
                  : wallet.status === 'connecting'
                    ? '请在钱包扩展中确认连接请求。'
                    : '规划可不连钱包；出资前需连接并就绪。'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!wallet.isWalletConnected ? (
            <Button
              type="button"
              className="units-cta h-10 rounded-xl px-5 font-semibold shadow-none"
              disabled={wallet.status === 'connecting'}
              onClick={() => void wallet.connect()}
            >
              {wallet.status === 'connecting' ? '连接中…' : '连接钱包'}
            </Button>
          ) : null}

          {wallet.isWrongNetwork ? (
            <Button
              type="button"
              className="h-10 rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-yellow)] px-5 font-semibold text-[var(--units-on-accent)] shadow-none"
              onClick={() => void wallet.switchToInjectiveTestnet()}
            >
              切换到测试网
            </Button>
          ) : null}

          {wallet.isWalletConnected ? (
            <button
              type="button"
              className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => void wallet.disconnect()}
            >
              断开连接
            </button>
          ) : null}
        </div>

        <SettingsSection title="连接信息">
          <SettingsRow label="地址">
            {wallet.address ? (
              <CopyableAddress address={wallet.address} size="sm" />
            ) : (
              <span className="text-[12.5px] text-muted-foreground">未连接</span>
            )}
          </SettingsRow>
          <SettingsRow label="Chain ID">
            <SettingsMutedValue>
              {wallet.chainId != null ? String(wallet.chainId) : '—'}
            </SettingsMutedValue>
          </SettingsRow>
        </SettingsSection>

        <Link
          to="/vault"
          onClick={onClose}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          打开金库查看余额与承保池
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
    </>
  )
}
