import { useMemo } from 'react'
import type {
  JourneyStage,
  ModelExplanation,
} from '@/features/policy-journey/types'
import { JOURNEY_STAGES_ORDERED } from '@/features/policy-journey/types'

export type ModelObservationByStage = Record<JourneyStage, ModelExplanation[]>

function sortNewestFirst(list: ModelExplanation[]): ModelExplanation[] {
  return [...list].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export function useModelObservation(explanations: ModelExplanation[]) {
  return useMemo(() => {
    const history = sortNewestFirst(explanations)
    const latest = history[0] ?? null

    const byStage = JOURNEY_STAGES_ORDERED.reduce<ModelObservationByStage>(
      (acc, stage) => {
        acc[stage] = sortNewestFirst(
          explanations.filter((item) => item.stage === stage)
        )
        return acc
      },
      {} as ModelObservationByStage
    )

    return { latest, history, byStage }
  }, [explanations])
}
