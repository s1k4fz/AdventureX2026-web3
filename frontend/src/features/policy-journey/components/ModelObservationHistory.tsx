import { ModelTrace } from '@/components/model-observation'
import type { ModelExplanation } from '../types'

export function ModelObservationHistory({
  explanations,
}: {
  explanations: ModelExplanation[]
}) {
  if (explanations.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        暂无模型观测记录。编排过程中的摘要会在此回溯。
      </p>
    )
  }

  const sorted = [...explanations].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )

  return (
    <div className="units-stage-enter">
      <h2 className="mb-3 text-sm font-semibold text-foreground">模型观测历史</h2>
      <ModelTrace explanations={sorted} defaultOpen />
    </div>
  )
}
