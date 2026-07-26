import { ExternalLink } from 'lucide-react'

import { cn } from '@/lib/utils'
import { EXPLORER_BASE, POLICY_VAULT_ADDRESS } from '@/features/wallet/viemClients'

function shorten(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function TxLink({
  hash,
  className,
  label,
}: {
  hash: string | null | undefined
  className?: string
  label?: string
}) {
  if (!hash) return null
  return (
    <a
      href={`${EXPLORER_BASE}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px] text-primary underline-offset-2 hover:underline',
        className
      )}
    >
      {label ?? shorten(hash, 10, 4)}
      <ExternalLink className="size-3 opacity-70" />
    </a>
  )
}

export function AddressLink({
  address,
  className,
  label,
}: {
  address: string | null | undefined
  className?: string
  label?: string
}) {
  if (!address) return null
  return (
    <a
      href={`${EXPLORER_BASE}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px] text-primary underline-offset-2 hover:underline',
        className
      )}
    >
      {label ?? shorten(address)}
      <ExternalLink className="size-3 opacity-70" />
    </a>
  )
}

export function OnChainPolicyId({
  policyId,
  className,
}: {
  policyId: string | null | undefined
  className?: string
}) {
  if (!policyId) return null
  // onChainPolicyId is a bytes32 id, not a tx hash — show as mono + link vault.
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <span className="font-mono text-[11px] text-foreground">{shorten(policyId, 10, 8)}</span>
      <AddressLink address={POLICY_VAULT_ADDRESS} label="Vault" />
    </span>
  )
}
