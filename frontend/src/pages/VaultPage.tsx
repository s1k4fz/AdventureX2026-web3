import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Droplets,
  ExternalLink,
  Fuel,
  RefreshCw,
  Vault,
  WalletCards,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DitherBackground } from '@/components/backgrounds/DitherBackground'
import type { DitherVariant } from '@/components/backgrounds/DitherBackground'
import { usePoliciesQuery } from '@/features/policy/policyApi'
import { PolicyStatusBadge } from '@/features/policy/PolicyStatusBadge'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { useMintTestUSDC } from '@/features/policy/useMintTestUSDC'
import {
  formatInj,
  formatUsdc6,
} from '@/features/vault/formatToken'
import { usePoolStats } from '@/features/vault/usePoolStats'
import { useWalletBalances } from '@/features/vault/useWalletBalances'
import { AddressLink } from '@/features/wallet/TxLink'
import { CopyableAddress } from '@/features/wallet/CopyableAddress'
import { useWallet } from '@/features/wallet/useWallet'
import {
  EXPLORER_BASE,
  MOCK_USDC_ADDRESS,
  POLICY_VAULT_ADDRESS,
} from '@/features/wallet/viemClients'
import { cn } from '@/lib/utils'

const MINT_AMOUNT = 1_000n * 1_000_000n // 1000 USDC
const FAUCET_URL = 'https://testnet.faucet.injective.network/'

const FLOW_STEPS = [
  {
    title: '连接并就绪',
    body: '连接 MetaMask 并切到 Injective 测试网。规划阶段可以不连钱包，真正出资前必须就绪。',
  },
  {
    title: '选定方案后出资',
    body: '选中一档方案，保费从你的 USDC 划入承保池，并按最大赔付锁定一笔准备金。',
  },
  {
    title: '保障期与结算',
    body: '保障期内准备金被占用；到期结算后释放回可用流动性，命中的保障则赔付到钱包。',
  },
]

interface PoolHealth {
  label: string
  tone: string
  hint: string
  dither: DitherVariant
}

/** 把资金利用率翻译成一句可读的承保池健康度判断（含氛围层情绪） */
function resolvePoolHealth(pct: number): PoolHealth {
  if (pct < 50) {
    return {
      label: '流动性充裕',
      tone: 'var(--units-green)',
      hint: '可用资金充足，能从容承接新保单。',
      dither: 'planning',
    }
  }
  if (pct < 80) {
    return {
      label: '运行稳健',
      tone: 'var(--units-blue)',
      hint: '占用与可用之间保持健康平衡。',
      dither: 'planning',
    }
  }
  if (pct < 95) {
    return {
      label: '占用偏高',
      tone: 'var(--units-yellow)',
      hint: '可用流动性收紧，大额保单可能被拒。',
      dither: 'active',
    }
  }
  return {
    label: '接近满载',
    tone: 'var(--units-orange)',
    hint: '几乎无闲置资金，暂难承接新的保障。',
    dither: 'active',
  }
}

function formatUpdatedAt(ts: number | null) {
  if (!ts) return '尚未同步'
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function UtilizationRing({
  percent,
  className,
}: {
  percent: number
  className?: string
}) {
  const clamped = Math.min(Math.max(percent, 0), 100)
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className={cn('relative size-[128px] sm:size-[140px]', className)}>
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="color-mix(in srgb, var(--units-black) 10%, transparent)"
          strokeWidth="12"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="var(--units-orange)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-display text-[26px] font-semibold leading-none tracking-tight">
          {clamped.toFixed(1)}%
        </p>
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          利用率
        </p>
      </div>
    </div>
  )
}

export function VaultPage() {
  const wallet = useWallet()
  const pool = usePoolStats()
  const balances = useWalletBalances()
  const policiesQuery = usePoliciesQuery()
  const mint = useMintTestUSDC()

  const activePolicies = useMemo(
    () =>
      (policiesQuery.data ?? []).filter(
        (policy) => policy.status === 'active' || policy.status === 'funded'
      ),
    [policiesQuery.data]
  )

  const poolHealth = pool.stats ? resolvePoolHealth(pool.utilizationPct) : null

  const statusLabel = wallet.isConnected
    ? '钱包已就绪'
    : wallet.isWrongNetwork
      ? '网络待切换'
      : wallet.status === 'connecting'
        ? '连接中…'
        : '未连接钱包'

  const statusHint = wallet.isConnected
    ? '已具备签名与出资条件，回到看板选方案即可出资。'
    : wallet.isWrongNetwork
      ? '请切换到 Injective 测试网 (1439) 后再出资。'
      : '规划可不连钱包；出资前需连接并切到测试网。'

  const StatusIcon = wallet.isConnected
    ? CheckCircle2
    : wallet.isWrongNetwork
      ? CircleAlert
      : WalletCards

  const handleRefresh = () => {
    void pool.refresh()
    void balances.refresh()
  }

  const handleMint = async () => {
    await mint.mint(MINT_AMOUNT)
    void balances.refresh()
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto units-app-panel">
      <header className="relative shrink-0 overflow-hidden border-b border-[var(--units-stroke-color)] px-4 py-5 sm:px-6">
        <DitherBackground
          variant={poolHealth?.dither ?? 'calm'}
          opacity={0.2}
          className="[mask-image:linear-gradient(to_bottom,black_30%,transparent)]"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-orange)] text-[var(--units-on-accent)]">
                <Vault className="size-4" strokeWidth={2.2} />
              </span>
              <div>
                <p className="units-text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  PolicyVault · Testnet
                </p>
                <h1 className="units-text-title text-foreground">金库</h1>
              </div>
            </div>
            <p className="units-text-body-sm mt-2 max-w-lg text-muted-foreground">
              先确认钱包就绪与余额，再查看承保池能否承接新保障。
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[12px] font-medium',
                wallet.isConnected
                  ? 'text-[var(--units-green)]'
                  : wallet.isWrongNetwork
                    ? 'text-[var(--units-orange)]'
                    : 'text-muted-foreground'
              )}
            >
              <StatusIcon className="size-3.5" />
              {statusLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              className="size-8 text-muted-foreground"
              aria-label="刷新余额与承保池"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6">
        {/* Primary: wallet readiness + balances + actions */}
        <section
          aria-labelledby="vault-wallet-heading"
          className="rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-soft)_88%,transparent)] p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                我的钱包
              </p>
              <h2
                id="vault-wallet-heading"
                className="font-display mt-1 text-xl font-semibold tracking-tight sm:text-2xl"
              >
                {statusLabel}
              </h2>
              <p className="mt-1 max-w-md text-[13px] leading-5 text-muted-foreground">
                {statusHint}
              </p>

              {wallet.address ? (
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  <CopyableAddress address={wallet.address} size="sm" />
                  <a
                    href={`${EXPLORER_BASE}/address/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    浏览器
                    <ExternalLink className="size-3 opacity-70" />
                  </a>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {!wallet.isWalletConnected ? (
                  <Button
                    type="button"
                    disabled={wallet.status === 'connecting'}
                    onClick={() => void wallet.connect()}
                    className="units-cta h-10 rounded-xl px-5 font-semibold shadow-none"
                  >
                    {wallet.status === 'connecting' ? '连接中…' : '连接 MetaMask'}
                  </Button>
                ) : null}

                {wallet.isWrongNetwork ? (
                  <Button
                    type="button"
                    onClick={() => void wallet.switchToInjectiveTestnet()}
                    className="h-10 rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-yellow)] px-5 font-semibold text-[var(--units-on-accent)] shadow-none"
                  >
                    切换到测试网
                  </Button>
                ) : null}

                {wallet.isConnected ? (
                  <>
                    <Button
                      type="button"
                      disabled={mint.step === 'minting'}
                      onClick={() => void handleMint()}
                      className="units-cta h-10 rounded-xl px-5 font-semibold shadow-none"
                    >
                      {mint.step === 'minting' ? '领取中…' : '领取 1000 USDC'}
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="h-10 rounded-xl border border-[var(--units-stroke-color)] bg-transparent px-4 shadow-none"
                    >
                      <a
                        href={FAUCET_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        INJ 水龙头
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  </>
                ) : null}
              </div>

              {wallet.isConnected ? (
                <button
                  type="button"
                  onClick={() => void wallet.disconnect()}
                  className="mt-3 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  断开连接
                </button>
              ) : null}

              {mint.step === 'success' ? (
                <p className="mt-3 text-[12.5px] text-[var(--units-green)]">
                  测试 USDC 已到账。
                </p>
              ) : null}
              {mint.step === 'error' && mint.errorMessage ? (
                <p className="mt-3 text-[12.5px] text-destructive">
                  {mint.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-[min(100%,320px)] lg:shrink-0 lg:grid-cols-1">
              <div className="rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-blue)] px-4 py-3.5 text-white">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide opacity-90">
                  <Droplets className="size-3.5" />
                  USDC · 测试币
                </div>
                <p className="mt-2 font-display text-[24px] font-semibold tracking-tight">
                  {wallet.isConnected && balances.usdcBalance !== null
                    ? formatUsdc6(balances.usdcBalance)
                    : '—'}
                </p>
              </div>
              <div className="rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-green)] px-4 py-3.5 text-white">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide opacity-90">
                  <Fuel className="size-3.5" />
                  INJ · Gas
                </div>
                <p className="mt-2 font-display text-[24px] font-semibold tracking-tight">
                  {wallet.isConnected && balances.injBalance !== null
                    ? formatInj(balances.injBalance)
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pool: one composition, no duplicate plates */}
        <section
          aria-labelledby="vault-pool-heading"
          className="border-t border-[var(--units-stroke-color)] pt-7"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                承保池
              </p>
              <h2
                id="vault-pool-heading"
                className="font-display mt-1 text-xl font-semibold tracking-tight"
              >
                {poolHealth ? poolHealth.label : 'PolicyVault 状态'}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {poolHealth?.hint ?? '只读链上数据，约每 15 秒刷新。'}
              </p>
            </div>
            {pool.stats ? (
              <p className="text-[11px] text-muted-foreground">
                更新于 {formatUpdatedAt(pool.updatedAt)} · 手续费{' '}
                {(pool.stats.feeBps / 100).toFixed(2)}%
              </p>
            ) : null}
          </div>

          {pool.loading && !pool.stats ? (
            <p className="mt-6 text-sm text-muted-foreground">加载承保池…</p>
          ) : null}
          {pool.error ? (
            <p className="mt-6 text-sm text-destructive">{pool.error}</p>
          ) : null}

          {pool.stats ? (
            <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
              <UtilizationRing percent={pool.utilizationPct} />
              <div className="w-full min-w-0 flex-1 space-y-4">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    池总规模
                  </p>
                  <p className="font-display text-[26px] font-semibold tracking-tight">
                    {formatUsdc6(pool.totalPool)}
                    <span className="ml-1.5 text-[12px] font-medium text-muted-foreground">
                      USDC
                    </span>
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">已占用</p>
                    <p className="mt-0.5 font-display text-[18px] font-semibold tracking-tight">
                      {formatUsdc6(pool.stats.reserved)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">可用</p>
                    <p className="mt-0.5 font-display text-[18px] font-semibold tracking-tight">
                      {formatUsdc6(pool.stats.freeLiquidity)}
                    </p>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-secondary">
                  <div
                    className="h-full bg-[var(--units-orange)] transition-all"
                    style={{
                      width: `${Math.min(pool.utilizationPct, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Policies occupying the pool */}
        <section
          aria-labelledby="vault-policies-heading"
          className="border-t border-[var(--units-stroke-color)] pt-7"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="vault-policies-heading"
                className="font-display text-lg font-semibold tracking-tight"
              >
                占用中的保单
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                已出资保单会锁定准备金。
              </p>
            </div>
            <Link
              to="/home"
              className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              看板
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          <div className="mt-4 space-y-1">
            {policiesQuery.isPending ? (
              <p className="text-sm text-muted-foreground">加载保单…</p>
            ) : activePolicies.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  还没有占用承保池的保单
                </p>
                <Button
                  asChild
                  className="units-cta h-9 rounded-xl px-4 font-semibold shadow-none"
                >
                  <Link to="/new">发起投保</Link>
                </Button>
              </div>
            ) : (
              activePolicies.slice(0, 5).map((policy) => (
                <Link
                  key={policy.id}
                  to={`/policy/${policy.id}`}
                  className="units-plate-hover flex items-center justify-between gap-3 border-b border-[var(--units-stroke-color)] px-0.5 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">
                      {policy.title || '未命名保单'}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      保费 {formatUsd(policy.premium ?? 0)} · 预期赔付{' '}
                      {formatUsd(policy.expectedPayout ?? 0)}
                    </p>
                  </div>
                  <PolicyStatusBadge status={policy.status} />
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Demoted: how-to + contracts */}
        <section className="space-y-2 border-t border-[var(--units-stroke-color)] pt-6">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden hover:text-foreground">
              <span>资金如何流动</span>
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <ol className="mt-1 space-y-3 pb-3 pl-0.5">
              {FLOW_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--units-radius-sm)] bg-[color-mix(in_srgb,var(--units-orange)_16%,transparent)] text-[11px] font-bold text-[var(--units-orange)]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </details>

          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden hover:text-foreground">
              <span>合约与资源</span>
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 pb-2 pt-1 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  PolicyVault
                </p>
                <p className="mt-1">
                  <CopyableAddress address={POLICY_VAULT_ADDRESS} size="sm" />
                </p>
                <div className="mt-1.5">
                  <AddressLink
                    address={POLICY_VAULT_ADDRESS}
                    label="在浏览器打开"
                    className="text-muted-foreground"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Mock USDC
                </p>
                <p className="mt-1">
                  <CopyableAddress address={MOCK_USDC_ADDRESS} size="sm" />
                </p>
                <div className="mt-1.5">
                  <AddressLink
                    address={MOCK_USDC_ADDRESS}
                    label="在浏览器打开"
                    className="text-muted-foreground"
                  />
                </div>
              </div>
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}
