import type { ComponentType } from 'react'

import type { AgentArtifact, AgentTaskDetail } from './types'
import { PolicyJourneyArtifact } from './artifacts/PolicyJourneyArtifact'

export interface ArtifactViewProps {
  task: AgentTaskDetail
  artifact: AgentArtifact
  policyId: string | null
  activities?: import('./types').AgentActivityItem[]
}

type RegistryEntry = {
  id: string
  label: string
  match: (task: AgentTaskDetail, artifact: AgentArtifact | null) => boolean
  unlocked: (task: AgentTaskDetail) => boolean
  component: ComponentType<ArtifactViewProps>
}

/** Single journey view — replaces the former multi-tab artifact registry. */
export const ARTIFACT_VIEWS: RegistryEntry[] = [
  {
    id: 'policy-journey',
    label: '保障旅程',
    match: () => true,
    unlocked: () => true,
    component: PolicyJourneyArtifact,
  },
]

export function resolveArtifactView(
  task: AgentTaskDetail,
  preferredId?: string | null
): RegistryEntry {
  if (preferredId) {
    const preferred = ARTIFACT_VIEWS.find((v) => v.id === preferredId)
    if (preferred?.unlocked(task)) return preferred
  }
  return ARTIFACT_VIEWS[0]!
}

export function canvasTabs(task: AgentTaskDetail, activeId?: string | null) {
  const tabs = ARTIFACT_VIEWS.map((view) => ({
    id: view.id,
    label: view.label,
    unlocked: view.unlocked(task),
  }))
  const active = resolveArtifactView(task, activeId).id
  return { tabs, active }
}
