export const TIER_ORDER: Array<'conservative' | 'balanced' | 'aggressive'> = [
  'conservative',
  'balanced',
  'aggressive',
]

export const TIER_LABELS: Record<
  'conservative' | 'balanced' | 'aggressive',
  string
> = {
  conservative: '稳健型',
  balanced: '均衡型',
  aggressive: '激进型',
}
