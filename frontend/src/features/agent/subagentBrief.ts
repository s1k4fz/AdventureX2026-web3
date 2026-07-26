/** Helpers for reading SourceBrief / meta from AgentSubagent wire payloads. */

import type {
  AgentCitation,
  AgentSourceBrief,
  AgentSourceBriefMeta,
  AgentSubagent,
} from './types'
import { INTEL_PROVIDER_LABELS } from './types'

function asProgressString(
  progress: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!progress) return null
  const value = progress[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readBrief(row: AgentSubagent | undefined): AgentSourceBrief | null {
  if (!row?.brief || typeof row.brief !== 'object') return null
  return row.brief
}

export function readMeta(
  row: AgentSubagent | undefined
): AgentSourceBriefMeta | null {
  const brief = readBrief(row)
  if (!brief?.meta || typeof brief.meta !== 'object') return null
  return brief.meta
}

export function briefSummary(row: AgentSubagent | undefined): string {
  if (!row) return '等待启动'
  const brief = readBrief(row)
  const fromBrief =
    typeof brief?.summary === 'string' ? brief.summary : null
  const fromProgress =
    row.progress && typeof row.progress.summary === 'string'
      ? row.progress.summary
      : null
  return (
    fromBrief ||
    fromProgress ||
    row.errorMessage ||
    (row.status === 'running'
      ? '采集中…'
      : row.status === 'pending'
        ? '排队中'
        : '')
  )
}

export function citationList(row: AgentSubagent | undefined): AgentCitation[] {
  const citations = readBrief(row)?.citations
  return Array.isArray(citations) ? citations : []
}

export function itemCount(row: AgentSubagent | undefined): number {
  const brief = readBrief(row)
  if (typeof brief?.itemCount === 'number') return brief.itemCount
  if (typeof brief?.item_count === 'number') return brief.item_count
  const fromProgress =
    row?.progress && typeof row.progress.itemCount === 'number'
      ? row.progress.itemCount
      : null
  if (fromProgress !== null) return fromProgress
  return citationList(row).length
}

export function providerLabel(row: AgentSubagent | undefined): string | null {
  const meta = readMeta(row)
  const raw =
    (typeof meta?.provider === 'string' && meta.provider) ||
    (row?.progress && typeof row.progress.provider === 'string'
      ? row.progress.provider
      : null)
  if (!raw) return null
  return INTEL_PROVIDER_LABELS[raw] ?? raw
}

export function fallbackLabel(row: AgentSubagent | undefined): string | null {
  const raw = readMeta(row)?.fallbackFrom
  if (typeof raw !== 'string' || !raw) return null
  return INTEL_PROVIDER_LABELS[raw] ?? raw
}

export function latencyLabel(row: AgentSubagent | undefined): string | null {
  const ms = readMeta(row)?.latencyMs
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const PROGRESS_PHASE_LABELS: Record<string, string> = {
  start: '开始检索',
  keywords: '扩展检索词',
  queries: '扩展检索词',
  keyword_search: '按词检索',
  leg: '按词检索',
  retry: '换角度重试',
  explore_miss: '本轮未命中',
  terminal: '写入候选池',
  source: '来源更新',
}

/** Live phase line from progress_json (phase / summary). */
export function progressPhaseLabel(
  row: AgentSubagent | undefined
): string | null {
  if (!row) return null
  const summary = asProgressString(row.progress, 'summary')
  if (summary) return summary
  const phase = asProgressString(row.progress, 'phase')
  if (!phase) return null
  return PROGRESS_PHASE_LABELS[phase] ?? phase
}

export function querySnippet(
  row: AgentSubagent | undefined,
  max = 48
): string | null {
  const fromRow =
    typeof row?.queryText === 'string' && row.queryText.trim()
      ? row.queryText.trim()
      : null
  const fromProgress = asProgressString(row?.progress, 'query')
  const fromMeta =
    typeof readMeta(row)?.query === 'string' ? readMeta(row)!.query! : null
  const text = fromRow || fromProgress || fromMeta
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Elapsed wall time between startedAt and finishedAt (or now). */
export function elapsedLabel(row: AgentSubagent | undefined): string | null {
  if (!row?.startedAt) return null
  const start = Date.parse(row.startedAt)
  if (!Number.isFinite(start)) return null
  const end = row.finishedAt ? Date.parse(row.finishedAt) : Date.now()
  if (!Number.isFinite(end) || end < start) return null
  const ms = end - start
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m${secs}s`
}

export function attemptList(
  row: AgentSubagent | undefined
): NonNullable<AgentSourceBriefMeta['attempts']> {
  const attempts = readMeta(row)?.attempts
  return Array.isArray(attempts) ? attempts : []
}
