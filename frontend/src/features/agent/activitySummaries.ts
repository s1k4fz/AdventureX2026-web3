import { INTEL_SUBAGENT_KINDS, subagentAlias, PARALLEL_SUBAGENT_KINDS } from './subagentIdentity'
import type { AgentApprovalKind } from './types'

export const APPROVAL_KIND_LABELS: Record<AgentApprovalKind, string> = {
  intake_answers: '填写风险问卷',
  select_portfolio: '选择保障档位',
  confirm_funding: '确认链上出资',
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function platformCounts(
  platforms: unknown
): Array<{ platform: string; count: number }> {
  if (!Array.isArray(platforms)) return []
  return platforms
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const platform = asString((row as { platform?: unknown }).platform)
      const count = asNumber((row as { count?: unknown }).count)
      if (!platform || count === null) return null
      return { platform, count }
    })
    .filter((row): row is { platform: string; count: number } => row !== null)
}

function formatPlatformCounts(
  platforms: Array<{ platform: string; count: number }>
): string {
  return platforms.map((row) => `${row.platform} ${row.count}`).join(' · ')
}

function truncateList(items: string[], max = 3): string {
  const shown = items.slice(0, max)
  const suffix = items.length > max ? ` 等 ${items.length} 条` : ''
  return `${shown.join('；')}${suffix}`
}

function readKeywords(data: Record<string, unknown>): string[] {
  const raw = Array.isArray(data.keywords)
    ? data.keywords
    : Array.isArray(data.queries)
      ? data.queries
      : []
  return raw
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
}

function readHitCount(data: Record<string, unknown>): number | null {
  return asNumber(data.hitCount) ?? asNumber(data.legCount)
}

/** Human-readable Chinese summary for research.updated event payloads. */
export function summarizeResearchUpdated(
  data: Record<string, unknown>
): string {
  const explicit = asString(data.summary)
  if (explicit) return explicit

  const phase = asString(data.phase)
  const kind = asString(data.kind)
  const platforms = platformCounts(data.platforms)
  const itemCount = Array.isArray(data.items) ? data.items.length : 0
  const totalCount =
    asNumber(data.totalCount) ??
    (platforms.length
      ? platforms.reduce((sum, row) => sum + row.count, 0)
      : itemCount > 0
        ? itemCount
        : null)
  const platformLabel = platforms.length
    ? formatPlatformCounts(platforms)
    : null

  if (phase === 'keywords' || phase === 'queries') {
    const keywords = readKeywords(data)
    if (keywords.length) {
      return `已扩展检索词 ${keywords.length} 条：${truncateList(keywords)}`
    }
    return '正在扩展预测市场检索词'
  }

  if (phase === 'keyword_search' || phase === 'leg') {
    const query = asString(data.query) ?? '当前检索词'
    const hitCount = readHitCount(data)
    const cumulative = asNumber(data.totalCount)
    const index = asNumber(data.index)
    const parts = [`检索「${query}」`]
    if (hitCount !== null) parts.push(`本轮命中 ${hitCount} 条`)
    if (cumulative !== null) parts.push(`累计 ${cumulative} 个候选`)
    if (index !== null && parts.length === 1) {
      parts.push(`第 ${index + 1} 路`)
    }
    return parts.join('，')
  }

  if (phase === 'retry') {
    const round = asNumber(data.round)
    return round !== null
      ? `第 ${round} 轮探索：换角度重试检索词`
      : '换角度重试检索词'
  }

  if (phase === 'explore_miss') {
    const round = asNumber(data.round)
    const keywords = readKeywords(data)
    const base =
      round !== null ? `第 ${round} 轮未命中` : '本轮未命中预测市场'
    return keywords.length
      ? `${base}，已尝试 ${keywords.length} 个检索词`
      : base
  }

  if (phase === 'market_matched') {
    return totalCount !== null
      ? `已匹配 ${totalCount} 个可用市场，正在校验方案依据`
      : '已匹配可用市场，正在校验方案依据'
  }

  if (phase === 'terminal' || asString(data.status) === 'searched') {
    if (totalCount !== null && platformLabel) {
      return `候选池已更新：共 ${totalCount} 个（${platformLabel}）`
    }
    if (totalCount !== null) {
      return `候选池已更新：共 ${totalCount} 个`
    }
    return '预测市场广搜结果已写入'
  }

  if (kind === 'search' || (platforms.length > 0 && itemCount > 0)) {
    if (totalCount !== null && platformLabel) {
      return `编排检索已更新：${totalCount} 个候选（${platformLabel}）`
    }
    if (totalCount !== null) {
      return `编排检索已更新：${totalCount} 个候选`
    }
    if (itemCount > 0) {
      return `编排检索已更新：${itemCount} 个候选`
    }
    return '编排检索资料已更新'
  }

  const query = asString(data.query)
  const cumulative = asNumber(data.totalCount)
  if (query && cumulative !== null) {
    return `检索「${query}」，累计 ${cumulative} 个候选`
  }
  if (query) return `正在检索「${query}」`
  if (cumulative !== null) return `研究资料更新：累计 ${cumulative} 个候选`
  if (platformLabel) {
    return `研究资料更新：${platformLabel}`
  }

  return '研究资料已更新'
}

/** Human-readable summary for subagent.* event payloads. */
export function summarizeSubagentEvent(
  eventType: string,
  data: Record<string, unknown>
): string {
  const explicit = asString(data.summary)
  const itemCount = asNumber(data.itemCount)

  if (eventType === 'subagent.fanout') {
    if (explicit) return explicit
    const kinds = Array.isArray(data.kinds)
      ? data.kinds
          .map((k) => asString(k))
          .filter((k): k is string => Boolean(k))
      : [...PARALLEL_SUBAGENT_KINDS]
    const names = kinds.map((k) => subagentAlias(k))
    const head = names.slice(0, 2).join('、')
    const rest = names.length > 2 ? `等 ${names.length} 名` : ''
    // Use "情报员" when dispatching intel-only sources
    const isIntelOnly = kinds.every((k) =>
      (INTEL_SUBAGENT_KINDS as string[]).includes(k)
    )
    const role = isIntelOnly ? '情报员' : '调查员'
    return `主理人派出${head}${rest}${role}`
  }

  if (eventType === 'subagent.fanin') {
    if (explicit) return explicit
    const phase = asString(data.phase)
    if (phase === 'parallel_gathered') return '市场候选与辅助情报已汇集'
    if (phase === 'intel_gathered') return '情报采集完成，开始关联预测市场'
    return '全源调查已汇集，情报官开始汇总'
  }

  const kind = asString(data.kind) ?? '子代理'
  const label = subagentAlias(kind)

  if (eventType === 'subagent.started') {
    // Prefer alias form even when backend still emits "启动 {kind}".
    if (explicit && !explicit.includes(kind)) return explicit
    return `启动 ${label}`
  }
  if (eventType === 'subagent.failed') {
    const err = asString(data.errorMessage)
    return err ? `${label}失败：${err}` : `${label}失败`
  }
  if (eventType === 'subagent.completed') {
    const brief =
      data.brief && typeof data.brief === 'object'
        ? (data.brief as Record<string, unknown>)
        : null
    const meta =
      brief?.meta && typeof brief.meta === 'object'
        ? (brief.meta as Record<string, unknown>)
        : null
    const provider =
      asString(meta?.provider) ?? asString(data.provider) ?? null
    const fallback =
      asString(meta?.fallbackFrom) ?? asString(data.fallbackFrom) ?? null
    const bits = [
      itemCount !== null ? `${itemCount} 条` : null,
      provider,
      fallback ? `降级自 ${fallback}` : null,
    ].filter(Boolean)
    if (bits.length) return `${label}完成 · ${bits.join(' · ')}`
    return `${label}完成`
  }
  if (eventType === 'subagent.updated') {
    return explicit ?? `${label}调查中`
  }
  return explicit ?? `${label}更新中`
}

export function summarizeApprovalCreated(kind: unknown): string {
  const key = asString(kind) as AgentApprovalKind | null
  const label =
    key && key in APPROVAL_KIND_LABELS
      ? APPROVAL_KIND_LABELS[key]
      : (key ?? '决策')
  return `需要你确认：${label}`
}

/** Format activity stream into staged markdown for Chain-of-Thought UI. */
export function formatActivitiesAsReasoning(
  activities: Array<{ summary: string; crumb?: string; sequence: number }>
): string {
  return activities
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => {
      const summary = item.summary.trim()
      const crumb = item.crumb?.trim() ?? ''
      if (summary && crumb && crumb !== summary) {
        return `### ${summary}\n\n${crumb}`
      }
      // Heading-only: splitReasoningSteps keeps the title; UI skips duplicate body.
      if (summary) return `### ${summary}`
      if (crumb) return crumb
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}
