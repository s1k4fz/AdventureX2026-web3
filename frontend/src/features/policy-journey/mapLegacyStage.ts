import type { JourneyStage } from './types'

/** Mirrors PolicyPlannerStage without importing policyApi (smoke-test friendly). */
export type PolicyPlannerStage =
  | 'questionnaire'
  | 'searching'
  | 'proposed'
  | 'active'
  | 'failed'

/**
 * Map PolicyPlannerStage → JourneyStage.
 *
 * Mapping:
 *   questionnaire → needs
 *   (post-questionnaire, pre-search) → risk_profile
 *   searching → market_research
 *   proposed → coverage_plan
 *   active → on_chain_active
 *   failed → defaults to needs
 */
export function toJourneyStage(
  legacy: PolicyPlannerStage,
  opts?: { questionnaireSubmitted?: boolean }
): JourneyStage {
  switch (legacy) {
    case 'questionnaire':
      return opts?.questionnaireSubmitted ? 'risk_profile' : 'needs'
    case 'searching':
      return 'market_research'
    case 'proposed':
      return 'coverage_plan'
    case 'active':
      return 'on_chain_active'
    case 'failed':
      return 'needs'
    default: {
      const _exhaustive: never = legacy
      void _exhaustive
      return 'needs'
    }
  }
}

/** Map JourneyStage back to PolicyPlannerStage. */
export function toLegacyStage(stage: JourneyStage): PolicyPlannerStage {
  switch (stage) {
    case 'needs':
      return 'questionnaire'
    case 'risk_profile':
      return 'questionnaire'
    case 'market_research':
      return 'searching'
    case 'coverage_plan':
      return 'proposed'
    case 'on_chain_active':
      return 'active'
    default: {
      const _exhaustive: never = stage
      void _exhaustive
      return 'questionnaire'
    }
  }
}
