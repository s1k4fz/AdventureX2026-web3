import { Check, Circle, Clock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { TxLink } from '@/features/wallet/TxLink'
import type { PolicyDetail } from './policyApi'

interface TimelineStep {
  key: string
  label: string
  timestamp?: string | null
  txHash?: string | null
  done: boolean
  current: boolean
}

function buildTimelineSteps(policy: PolicyDetail): TimelineStep[] {
  const statusOrder = [
    'intake',
    'composing',
    'proposed',
    'funded',
    'active',
    'settled',
  ]
  const idx = statusOrder.indexOf(policy.status)
  const failed = policy.status === 'failed'

  const stepDone = (stepStatus: string) => {
    if (failed) return false
    const stepIdx = statusOrder.indexOf(stepStatus)
    return idx >= stepIdx && idx >= 0
  }

  const stepCurrent = (stepStatus: string) => policy.status === stepStatus

  return [
    {
      key: 'created',
      label: '创建保单',
      timestamp: policy.createdAt ?? policy.updatedAt,
      done: true,
      current: policy.status === 'intake' && !policy.questionnaireReady,
    },
    {
      key: 'questionnaire',
      label: '完成问卷',
      timestamp:
        policy.status !== 'intake' ? policy.updatedAt : null,
      done: stepDone('composing') || stepDone('proposed'),
      current:
        policy.status === 'intake' && policy.questionnaireReady,
    },
    {
      key: 'compose',
      label: 'AI 编排方案',
      timestamp:
        ['proposed', 'funded', 'active', 'settled'].includes(policy.status)
          ? policy.updatedAt
          : null,
      done: stepDone('proposed'),
      current: stepCurrent('composing'),
    },
    {
      key: 'fund',
      label: '出资开保',
      timestamp: policy.openTx ? policy.updatedAt : null,
      txHash: policy.openTx,
      done: stepDone('active') || stepDone('settled'),
      current: stepCurrent('proposed') || stepCurrent('funded'),
    },
    {
      key: 'active',
      label: '保障生效',
      timestamp: policy.coverageEnd,
      done: stepDone('active') || stepDone('settled'),
      current: stepCurrent('active'),
    },
    {
      key: 'settled',
      label: '结算完成',
      timestamp: policy.settleTx ? policy.updatedAt : null,
      txHash: policy.settleTx,
      done: stepDone('settled'),
      current: stepCurrent('settled'),
    },
  ]
}

function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16)
  }
}

export function PolicyTimeline({ policy }: { policy: PolicyDetail }) {
  const steps = buildTimelineSteps(policy)

  if (policy.status === 'failed') {
    return (
      <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-4">
        <p className="text-sm font-medium text-rose-300">保单处理失败</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          该保单未能完成编排或出资，请重新发起投保。
        </p>
      </div>
    )
  }

  return (
    <ol className="relative space-y-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return (
          <li key={step.key} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span
                className={cn(
                  'absolute left-[11px] top-6 h-[calc(100%-12px)] w-px',
                  step.done ? 'bg-emerald-500/40' : 'bg-border'
                )}
              />
            )}
            <div className="relative z-10 mt-0.5 shrink-0">
              {step.done ? (
                <span className="flex size-[22px] items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                  <Check className="size-3.5" strokeWidth={2.5} />
                </span>
              ) : step.current ? (
                <span className="flex size-[22px] items-center justify-center rounded-full bg-primary/20 text-primary">
                  <Clock className="size-3.5" strokeWidth={2} />
                </span>
              ) : (
                <span className="flex size-[22px] items-center justify-center rounded-full border border-border bg-secondary/50 text-muted-foreground">
                  <Circle className="size-2.5 fill-current" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={cn(
                  'text-[13px] font-medium',
                  step.done || step.current
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {step.label}
              </p>
              {step.timestamp && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatTimestamp(step.timestamp)}
                </p>
              )}
              {step.txHash && <TxLink hash={step.txHash} className="mt-0.5" />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
