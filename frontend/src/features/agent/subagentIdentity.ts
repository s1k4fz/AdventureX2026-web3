/** Canonical Subagent identity: alias (工牌名), role label, accent. */

import type { AgentSubagentKind } from './types'

export type SubagentIdentity = {
  kind: AgentSubagentKind
  /** Display name on the badge (工牌名). */
  alias: string
  /** Short duty label under the alias. */
  role: string
  /** Legacy / technical name. */
  technical: string
  /** CSS color token for avatar plate. */
  accent: string
  /** One-character monogram for the badge face. */
  monogram: string
}

export const MAIN_AGENT_IDENTITY = {
  alias: '主理人',
  role: '派发与编排',
  accent: 'var(--units-orange)',
  monogram: '主',
} as const

export const SUBAGENT_IDENTITIES: Record<AgentSubagentKind, SubagentIdentity> = {
  polymarket: {
    kind: 'polymarket',
    alias: '行情侦察',
    role: '预测市场',
    technical: 'Polymarket',
    accent: 'var(--units-blue)',
    monogram: '行',
  },
  world_monitor: {
    kind: 'world_monitor',
    alias: '全球瞭望',
    role: '宏观信号',
    technical: 'WorldMonitor',
    accent: 'var(--units-green)',
    monogram: '望',
  },
  pandaai: {
    kind: 'pandaai',
    alias: '量数观测',
    role: '金融数据',
    technical: 'PandaAI',
    accent: 'var(--units-blue)',
    monogram: '量',
  },
  news: {
    kind: 'news',
    alias: '新闻猎手',
    role: '新闻检索',
    technical: 'News',
    accent: 'var(--units-yellow)',
    monogram: '闻',
  },
  web: {
    kind: 'web',
    alias: '网页探查',
    role: '网页检索',
    technical: 'Web',
    accent: 'var(--units-lilac)',
    monogram: '网',
  },
  synthesizer: {
    kind: 'synthesizer',
    alias: '情报官',
    role: '多源汇总',
    technical: 'Synthesizer',
    accent: 'var(--units-orange)',
    monogram: '情',
  },
}

export function getSubagentIdentity(
  kind: string | null | undefined
): SubagentIdentity {
  if (kind && kind in SUBAGENT_IDENTITIES) {
    return SUBAGENT_IDENTITIES[kind as AgentSubagentKind]
  }
  return {
    kind: (kind as AgentSubagentKind) || 'polymarket',
    alias: kind || '子代理',
    role: '调查员',
    technical: kind || 'unknown',
    accent: 'var(--units-black)',
    monogram: '调',
  }
}

/** Alias-first label used in activity / inspector copy. */
export function subagentAlias(kind: string | null | undefined): string {
  return getSubagentIdentity(kind).alias
}

export const PARALLEL_SUBAGENT_KINDS: AgentSubagentKind[] = [
  'polymarket',
  'world_monitor',
  'pandaai',
  'news',
  'web',
]

/** Phase 1 intel sources that run before Polymarket to provide context. */
export const INTEL_SUBAGENT_KINDS: AgentSubagentKind[] = [
  'world_monitor',
  'pandaai',
  'news',
  'web',
]
