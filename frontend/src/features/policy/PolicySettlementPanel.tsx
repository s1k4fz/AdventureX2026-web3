import { Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TxLink, OnChainPolicyId } from '@/features/wallet/TxLink'
import type { PolicyDetail } from './policyApi'
import { formatUsd } from './portfolioUtils'
import { findSelectedPortfolio } from './portfolioUtils'

export function PolicySettlementPanel({ policy }: { policy: PolicyDetail }) {
  const selected = findSelectedPortfolio(
    policy.portfolios,
    policy.selectedPortfolioId
  )
  const outcomes = policy.settlementOutcomes
  const positions = selected?.positions ?? []

  return (
    <div className="space-y-4 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">结算结果</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          预言机已确认各市场结果并完成链上结算。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="实际赔付" value={formatUsd(policy.payout ?? 0)} highlight />
        <Stat
          label="投入保费"
          value={formatUsd(policy.premium ?? 0)}
        />
        <Stat
          label="净收益"
          value={
            policy.premium != null && policy.payout != null
              ? `${policy.payout - policy.premium >= 0 ? '+' : ''}${formatUsd(policy.payout - policy.premium)}`
              : '—'
          }
          positive={
            policy.premium != null &&
            policy.payout != null &&
            policy.payout >= policy.premium
          }
        />
      </div>

      {(outcomes && outcomes.length > 0 ? outcomes : positions).map(
        (item, index) => {
          const isOutcome = 'outcomeYes' in item
          const hit = isOutcome
            ? (item as { hit: boolean }).hit
            : null
          const question = item.question
          const side = item.side
          const outcomeYes = isOutcome
            ? (item as { outcomeYes: boolean }).outcomeYes
            : null

          return (
            <div
              key={isOutcome ? item.marketRef : `pos-${index}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3"
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                  hit === true
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : hit === false
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-secondary text-muted-foreground'
                )}
              >
                {hit === true ? (
                  <Check className="size-3" />
                ) : hit === false ? (
                  <X className="size-3" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{question}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      'rounded px-1 py-0.5 font-semibold',
                      side === 'YES'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/15 text-rose-400'
                    )}
                  >
                    投保 {side}
                  </span>
                  {outcomeYes != null && (
                    <span>
                      市场结果：{outcomeYes ? 'YES' : 'NO'}
                      {hit != null && (
                        <span
                          className={cn(
                            'ml-1',
                            hit ? 'text-emerald-400' : 'text-rose-400'
                          )}
                        >
                          ({hit ? '命中' : '未命中'})
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        }
      )}

      {policy.settleTx && (
        <p className="text-[12px] text-muted-foreground">
          结算交易 <TxLink hash={policy.settleTx} />
        </p>
      )}

      {policy.onChainPolicyId && (
        <p className="text-[12px] text-muted-foreground">
          链上保单 <OnChainPolicyId policyId={policy.onChainPolicyId} />
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
  positive,
}: {
  label: string
  value: string
  highlight?: boolean
  positive?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-semibold',
          highlight
            ? 'text-primary'
            : positive === true
              ? 'text-emerald-400'
              : positive === false
                ? 'text-rose-400'
                : 'text-foreground'
        )}
      >
        {value}
      </p>
    </div>
  )
}
