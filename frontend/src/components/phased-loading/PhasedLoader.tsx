import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneyStage, StageStatus } from '@/features/policy-journey/types'
import { STAGE_LABELS } from '@/features/policy-journey/types'
import { ScanLine } from './ScanLine'
import { SignalPulse } from './SignalPulse'
import { SkeletonReveal } from './SkeletonReveal'

export interface PhasedLoaderProps {
  stage: JourneyStage
  status: StageStatus
  message?: string
  className?: string
}

function WaitingMessage({
  stage,
  message,
  className,
}: {
  stage: JourneyStage
  message?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'units-stage-enter rounded-xl border border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-3 py-2.5',
        className
      )}
      role="status"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        等待确认 · {STAGE_LABELS[stage]}
      </p>
      <p className="mt-1 text-[11px] tracking-tight text-foreground">
        {message ?? '请确认后继续下一步'}
      </p>
    </div>
  )
}

function ErrorMessage({
  stage,
  message,
  className,
}: {
  stage: JourneyStage
  message?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'units-stage-enter rounded-xl border border-[color-mix(in_srgb,var(--destructive)_35%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] px-3 py-2.5',
        className
      )}
      role="alert"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive">
        {STAGE_LABELS[stage]}失败
      </p>
      <p className="mt-1 text-[11px] tracking-tight text-foreground">
        {message ?? '阶段执行失败，请稍后重试'}
      </p>
    </div>
  )
}

function SuccessCheck({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'units-stage-enter inline-flex items-center gap-1.5 rounded-full border border-[var(--units-stroke-color)] bg-secondary px-2.5 py-1 text-[11px] tracking-tight text-muted-foreground',
        className
      )}
      role="status"
    >
      <Check className="size-3 text-[var(--units-orange)]" aria-hidden />
      <span>已完成</span>
    </div>
  )
}

export function PhasedLoader({
  stage,
  status,
  message,
  className,
}: PhasedLoaderProps) {
  if (status === 'success') {
    return <SuccessCheck className={className} />
  }

  if (status === 'failed') {
    return <ErrorMessage stage={stage} message={message} className={className} />
  }

  if (status === 'waiting_confirmation') {
    return (
      <WaitingMessage stage={stage} message={message} className={className} />
    )
  }

  if (status !== 'loading' && status !== 'retry') {
    return null
  }

  if (stage === 'market_research') {
    return (
      <ScanLine
        className={className}
        label={message ?? '扫描市场中…'}
      />
    )
  }

  if (stage === 'on_chain_active') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <SignalPulse />
        <span className="text-[11px] tracking-tight text-muted-foreground">
          {message ?? '链上同步中…'}
        </span>
      </div>
    )
  }

  if (stage === 'needs' || stage === 'risk_profile') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <SkeletonReveal loading>
          <div className="h-16" />
        </SkeletonReveal>
        <div className="flex items-center gap-2">
          <SignalPulse />
          <span className="text-[11px] tracking-tight text-muted-foreground">
            {message ??
              (stage === 'needs' ? '分析需求中…' : '构建风险画像中…')}
          </span>
        </div>
      </div>
    )
  }

  if (stage === 'coverage_plan') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <SkeletonReveal loading>
          <div className="h-20" />
        </SkeletonReveal>
        {message ? (
          <p className="text-[11px] tracking-tight text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>
    )
  }

  return null
}
