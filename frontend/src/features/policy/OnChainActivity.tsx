import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Circle, Clock, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TxLink, OnChainPolicyId, AddressLink } from '@/features/wallet/TxLink'
import { POLICY_VAULT_ADDRESS, MOCK_USDC_ADDRESS } from '@/features/wallet/viemClients'
import type { FundingStep } from '@/features/policy/useFundPolicy'

interface ChainStep {
  key: string
  label: string
  done: boolean
  current: boolean
  txHash?: string | null
  detail?: string | null
  techDetail?: string | null
}

const FUNDING_ORDER: FundingStep[] = [
  'selecting',
  'checking-balance',
  'minting',
  'approving',
  'funding',
  'confirming',
  'success',
]

function fundingIndex(step: FundingStep): number {
  const idx = FUNDING_ORDER.indexOf(step)
  return idx >= 0 ? idx : -1
}

function TechDetails({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left text-[11px] text-muted-foreground"
      >
        <span>技术详情</span>
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>
      {open ? <div className="mt-1.5 flex flex-col gap-1.5">{children}</div> : null}
    </div>
  )
}

/**
 * 出资过程中的链上步骤可视化：mint → approve → openPolicy → confirm。
 * `awaitingStart` 用于选档后、尚未点击出资时展示「待你操作」骨架。
 */
export function FundingChainSteps({
  step,
  approveTx,
  openTx,
  onChainPolicyId,
  errorMessage,
  awaitingStart = false,
  className,
}: {
  step: FundingStep
  approveTx?: string | null
  openTx?: string | null
  onChainPolicyId?: string | null
  errorMessage?: string | null
  awaitingStart?: boolean
  className?: string
}) {
  const [techOpen, setTechOpen] = useState(false)

  if (step === 'idle' && !awaitingStart) return null

  const idx = fundingIndex(step)
  const failed = step === 'error'
  const preview = step === 'idle' && awaitingStart

  const steps: ChainStep[] = [
    {
      key: 'select',
      label: '确认方案',
      done: preview || (!failed && idx > 0),
      current: !preview && step === 'selecting',
      detail: preview ? '档位已锁定' : null,
    },
    {
      key: 'balance',
      label: '检查余额 / 测试币',
      done: !failed && idx > fundingIndex('minting'),
      current: preview || step === 'checking-balance' || step === 'minting',
      detail: preview ? '待你操作：设置保费并开始出资' : null,
    },
    {
      key: 'approve',
      label: '授权 USDC（approve）',
      done: !failed && (idx > fundingIndex('approving') || Boolean(approveTx)),
      current: !preview && step === 'approving',
      txHash: approveTx,
      detail: '允许保费金库划转本次保费',
      techDetail: 'MockUSDC.approve → PolicyVault',
    },
    {
      key: 'open',
      label: '开保并锁定保费（openPolicy）',
      done: !failed && (idx > fundingIndex('funding') || Boolean(openTx)),
      current: !preview && step === 'funding',
      txHash: openTx,
      detail: '提交开保交易，锁定保费与保障头寸',
      techDetail: 'PolicyVault.openPolicy',
    },
    {
      key: 'confirm',
      label: '链上确认入库',
      done: step === 'success',
      current: !preview && step === 'confirming',
      detail: '等待区块确认并写入保单状态',
    },
  ]

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-secondary/30 p-3',
        !awaitingStart && 'mt-3',
        className
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-foreground">
          {preview ? '出资进度' : '链上交互进度'}
        </p>
        <p className="text-[10px] text-muted-foreground">Injective 测试网</p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              {s.done ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : s.current && !failed ? (
                preview ? (
                  <Clock className="size-3.5 text-[var(--units-orange)]" />
                ) : (
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                )
              ) : failed && s.current ? (
                <Circle className="size-3.5 text-rose-400" />
              ) : (
                <Clock className="size-3.5 text-muted-foreground/50" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[12px]',
                  s.done || s.current ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {s.label}
                {preview && s.current ? (
                  <span className="ms-1.5 text-[10px] font-medium text-[var(--units-orange)]">
                    待你操作
                  </span>
                ) : null}
              </p>
              {s.detail && (
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              )}
              {s.txHash && (
                <TxLink hash={s.txHash} className="mt-0.5" label="查看交易" />
              )}
            </div>
          </li>
        ))}
      </ol>
      {onChainPolicyId && (
        <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          链上保单 ID{' '}
          <OnChainPolicyId policyId={onChainPolicyId} className="ml-1" />
        </div>
      )}
      <TechDetails open={techOpen} onToggle={() => setTechOpen((v) => !v)}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">测试 USDC</span>
          <AddressLink address={MOCK_USDC_ADDRESS} label="MockUSDC" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">保费金库</span>
          <AddressLink address={POLICY_VAULT_ADDRESS} label="PolicyVault" />
        </div>
        {steps
          .filter((s) => s.techDetail)
          .map((s) => (
            <p key={s.key} className="font-mono text-[10px] text-muted-foreground">
              {s.label.split('（')[0]} · {s.techDetail}
            </p>
          ))}
      </TechDetails>
      {failed && errorMessage && (
        <p className="mt-2 text-[12px] text-rose-400">{errorMessage}</p>
      )}
    </div>
  )
}

/**
 * 保单详情侧的链上活动摘要：合约、交易、保单 ID。
 */
export function OnChainActivityPanel({
  openTx,
  settleTx,
  onChainPolicyId,
  status,
  oracleAddress,
}: {
  openTx?: string | null
  settleTx?: string | null
  onChainPolicyId?: string | null
  status?: string
  oracleAddress?: string | null
}) {
  const [techOpen, setTechOpen] = useState(false)
  const hasAny = openTx || settleTx || onChainPolicyId
  if (!hasAny) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted-foreground">
        尚未发生链上交互。选择方案并出资后，将在此展示授权、开保与结算交易。
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">链上活动</h3>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Injective 测试网 · 状态 {status ?? '—'}
      </p>
      <dl className="mt-3 flex flex-col gap-2.5 text-[12px]">
        {onChainPolicyId && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">链上保单 ID</dt>
            <dd>
              <OnChainPolicyId policyId={onChainPolicyId} />
            </dd>
          </div>
        )}
        {openTx && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">开保交易（openPolicy）</dt>
            <dd>
              <TxLink hash={openTx} label="查看交易" />
            </dd>
          </div>
        )}
        {settleTx && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">结算交易</dt>
            <dd>
              <TxLink hash={settleTx} label="查看交易" />
            </dd>
          </div>
        )}
      </dl>
      <TechDetails open={techOpen} onToggle={() => setTechOpen((v) => !v)}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">保费金库（PolicyVault）</span>
          <AddressLink address={POLICY_VAULT_ADDRESS} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">测试 USDC（MockUSDC）</span>
          <AddressLink address={MOCK_USDC_ADDRESS} />
        </div>
        {oracleAddress && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">结果预言机（OutcomeOracle）</span>
            <AddressLink address={oracleAddress} />
          </div>
        )}
      </TechDetails>
    </div>
  )
}
