import { useState } from 'react'
import { Check, Copy, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AddressText } from '@/features/wallet/CopyableAddress'
import { useWallet } from './useWallet'

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

/**
 * Minimal wallet connect button. Handles connect + switch-to-Injective-Testnet.
 *
 * TODO(M2): USDC approve / openPolicy ABI encoding requires viem and is
 * DEFERRED to Milestone 2. This button currently only connects and switches
 * network — funding actions are disabled.
 */
export function WalletConnectButton({ className }: { className?: string }) {
  const { address, status, isWrongNetwork, connect, switchToInjectiveTestnet } =
    useWallet()
  const [copied, setCopied] = useState(false)

  const handleClick = () => {
    if (status === 'connected' && address) {
      void (async () => {
        const ok = await copyText(address)
        if (!ok) return
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })()
      return
    }

    if (status === 'disconnected') {
      void connect()
    } else if (isWrongNetwork) {
      void switchToInjectiveTestnet()
    }
  }

  const isConnected = status === 'connected' && !!address

  const label = (() => {
    switch (status) {
      case 'disconnected':
        return '连接钱包'
      case 'connecting':
        return '连接中…'
      case 'wrong-network':
        return '切换网络'
      case 'connected':
        if (copied) return null
        return address ? null : '已连接'
    }
  })()

  const TrailingIcon = isConnected ? (copied ? Check : Copy) : Wallet

  return (
    <Button
      type="button"
      variant={isConnected ? 'ghost' : 'outline'}
      disabled={status === 'connecting'}
      onClick={handleClick}
      data-copied={isConnected && copied ? 'true' : undefined}
      aria-label={
        isConnected && address
          ? copied
            ? `已复制地址 ${address}`
            : `复制地址 ${address}，悬停可核对完整地址`
          : undefined
      }
      className={cn(
        'group inline-flex max-w-[11rem] items-center gap-1.5 text-[13px] shadow-none sm:max-w-[12rem]',
        !isConnected && 'rounded-full',
        className,
        isConnected &&
          'units-address h-auto max-w-none overflow-visible rounded-sm border-0 bg-transparent px-1 py-0.5 font-normal shadow-none hover:bg-transparent'
      )}
    >
      <TrailingIcon
        className={cn(
          'size-3.5 shrink-0',
          isConnected && 'units-address-icon',
          isConnected && !copied && 'group-hover:rotate-[-8deg]'
        )}
      />
      {isConnected && address ? (
        <>
          <AddressText address={address} size="sm" />
          <span className="units-address-hint">{copied ? '已复制' : '复制'}</span>
        </>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </Button>
  )
}
