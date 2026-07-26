import type { RiskFactorCategory } from '@/features/policy/policyApi'

import { StageLiveStatus } from '../components/StageLiveStatus'
import { StageShell, StageSkeletonBlock } from '../components/StageShell'
import type { StageStatus } from '../types'

const PROFILING_HINTS = [
  '正在解析你的问卷回答…',
  '正在归纳风险因子类别…',
  '画像完成后会自动进入市场检索…',
]

export interface RiskProfileStageProps {
  factorCategories?: RiskFactorCategory[]
  stageStatus?: StageStatus
  errorMessage?: string | null
}

export function RiskProfileStage({
  factorCategories = [],
  stageStatus = 'loading',
  errorMessage,
}: RiskProfileStageProps) {
  const isLoading =
    stageStatus === 'loading' ||
    stageStatus === 'retry' ||
    factorCategories.length === 0
  const hasFactors = factorCategories.length > 0

  return (
    <StageShell
      stage="risk_profile"
      title={hasFactors ? '你的风险画像已就绪' : '正在构建你的风险画像'}
      description="根据问卷回答识别风险因子类别，为后续市场检索与方案编排提供约束。"
      headerBelow={
        isLoading ? (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--units-black)_8%,transparent)]"
            aria-hidden
          >
            <div className="units-loading-bar-fill h-full w-1/3 rounded-full bg-[var(--units-orange)]" />
          </div>
        ) : undefined
      }
    >
      <div
        className="flex flex-col gap-2.5"
        role="status"
        aria-live="polite"
        aria-busy={isLoading}
      >
        {hasFactors ? (
          <p className="text-[12.5px] font-medium text-muted-foreground">
            已识别 {factorCategories.length} 个风险因子类别
          </p>
        ) : (
          <StageLiveStatus
            hints={PROFILING_HINTS}
            note="风险画像会约束后续的市场检索与方案编排"
          />
        )}

        {hasFactors ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {factorCategories.map((cat) => (
              <div
                key={cat.id}
                className="units-stage-enter flex flex-col rounded-xl border border-[color-mix(in_srgb,var(--units-green)_32%,transparent)] bg-[color-mix(in_srgb,var(--units-green)_8%,transparent)] px-3.5 py-3"
              >
                <span className="text-[13px] font-semibold text-foreground">
                  {cat.label}
                </span>
                {cat.rationale ? (
                  <span className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {cat.rationale}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((row) => (
              <StageSkeletonBlock key={row} className="h-[74px] w-full" />
            ))}
          </div>
        )}
      </div>

      {errorMessage ? (
        <p className="text-[14px] text-destructive">{errorMessage}</p>
      ) : null}
    </StageShell>
  )
}
