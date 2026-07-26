// Market search hits shown while composing. camelCase off the wire.
export interface MarketSearchPlatformHit {
  platform: string
  count: number
}

export interface MarketSearchItem {
  platform: string
  question: string
  volume: number | null
  liquidity?: number | null
  conditionId?: string | null
  url?: string | null
  endDate: string | null
}

export interface MarketSearchProgress {
  platforms: MarketSearchPlatformHit[]
  items: MarketSearchItem[]
  /** Full pool size; equals items.length when payload is untruncated. */
  totalCount?: number
}

/**
 * Compose live progress is projected from Agent Task events
 * (`usePolicyComposeStream` → `/agent-tasks/by-policy/...` + events SSE).
 * This module only retains the shared MarketSearchProgress wire types.
 */
