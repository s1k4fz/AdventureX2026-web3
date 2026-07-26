import { format, parseISO, startOfDay, startOfWeek } from 'date-fns'

import type { AgentTaskListItem } from '@/features/agent/types'
import { statusHint } from '@/features/agent/taskSidebarMeta'
import type { PolicyCalendarEvent } from '@/features/policy/PolicyEventsCalendar'
import type { PolicyListItem } from '@/features/policy/policyApi'
import { formatUsd } from '@/features/policy/portfolioUtils'
import {
  formatCountdown,
  isCoverageExpired,
  isCoverageWithinDays,
} from '@/features/policy/policyStatus'
import { KIND_COLOR, KIND_LABEL } from './scheduleKindStyles'
import type {
  ScheduleAction,
  ScheduleEvent,
  ScheduleUrgency,
} from './types'
import { buildDemoScheduleEvents } from './types'
import type { ScheduleTaskCardProps } from './TaskCard'
import type { ScheduleWatchItem } from './watchItemsApi'

const TIER_LABELS: Record<string, string> = {
  conservative: '稳健型',
  balanced: '均衡型',
  aggressive: '激进型',
}

const URGENCY_RANK: Record<ScheduleUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function localDateKey(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback
  try {
    const day = startOfDay(parseISO(iso))
    if (Number.isNaN(day.getTime())) return iso.slice(0, 10) || fallback
    return format(day, 'yyyy-MM-dd')
  } catch {
    return iso.slice(0, 10) || fallback
  }
}

function todayKeyFromMs(nowMs: number): string {
  return format(startOfDay(new Date(nowMs)), 'yyyy-MM-dd')
}

function tierLabel(tier: string | null | undefined): string | null {
  if (!tier) return null
  return TIER_LABELS[tier] ?? tier
}

function policyHref(policyId: string, tab?: 'nft'): string {
  return tab ? `/policy/${policyId}?tab=${tab}` : `/policy/${policyId}`
}

function taskHref(taskId: string): string {
  return `/tasks/${taskId}`
}

function moneyMeta(policy: PolicyListItem): {
  premiumLabel?: string
  payoutLabel?: string
  meta: string[]
  tier: string | null
} {
  const tier = tierLabel(policy.selectedPortfolioTier)
  const premiumLabel =
    policy.premium != null ? `保费 ${formatUsd(policy.premium)}` : undefined
  const payoutLabel =
    policy.expectedPayout != null
      ? `最大赔付 ${formatUsd(policy.expectedPayout)}`
      : undefined
  const meta = [premiumLabel, payoutLabel, tier].filter(Boolean) as string[]
  return { premiumLabel, payoutLabel, meta, tier }
}

function goalSnippetFromTask(task: AgentTaskListItem | undefined): string | undefined {
  if (!task) return undefined
  // Prefer AI-generated description over raw goal text truncation
  if (task.description) return task.description
  if (!task.goalText) return undefined
  const text = task.goalText.trim()
  if (!text) return undefined
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

function buildActions(primary: ScheduleAction, extras: ScheduleAction[] = []): ScheduleAction[] {
  const seen = new Set<string>()
  const out: ScheduleAction[] = []
  for (const action of [primary, ...extras]) {
    const key = `${action.label}|${action.href}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(action)
  }
  return out
}

/** 将保单日历事件映射为全日 ScheduleEvent（附带真实元数据与行动入口） */
export function scheduleEventsFromPolicyCalendar(
  events: PolicyCalendarEvent[],
  policies: PolicyListItem[] = [],
  agentByPolicyId: Map<string, AgentTaskListItem> = new Map(),
  nowMs: number = Date.now()
): ScheduleEvent[] {
  const byId = new Map(policies.map((p) => [p.id, p]))

  return events.flatMap((event) => {
    let day: Date
    try {
      day = startOfDay(parseISO(event.date))
      if (Number.isNaN(day.getTime())) return []
    } catch {
      return []
    }
    const date = format(day, 'yyyy-MM-dd')
    const policyId = event.href?.match(/^\/policy\/([^/?]+)/)?.[1]
    const policy = policyId ? byId.get(policyId) : undefined
    const agent = policyId ? agentByPolicyId.get(policyId) : undefined
    const money = policy ? moneyMeta(policy) : { meta: [] as string[], tier: null }
    const countdown = policy?.coverageEnd
      ? formatCountdown(policy.coverageEnd)
      : null

    let kind: ScheduleEvent['kind'] = event.kind
    let kindLabel = KIND_LABEL[event.kind]
    let urgency: ScheduleUrgency = 'low'
    let nextActionLabel: string | undefined
    let nextActionHref: string | undefined
    let healthHint: string | undefined
    let color = KIND_COLOR[event.kind]

    if (policy && event.kind === 'coverage_end') {
      const expired = isCoverageExpired(policy.coverageEnd, nowMs)
      if (policy.status === 'active' && expired) {
        kind = 'settle'
        kindLabel = KIND_LABEL.settle
        color = KIND_COLOR.settle
        urgency = 'critical'
        nextActionLabel = '查看结算进度'
        nextActionHref = policyHref(policy.id)
        healthHint = '保障已到期，等待链上结算 / Oracle 确认'
      } else if (policy.status === 'active' && isCoverageWithinDays(policy.coverageEnd, 14, nowMs)) {
        urgency = isCoverageWithinDays(policy.coverageEnd, 7, nowMs) ? 'high' : 'medium'
        nextActionLabel = '查看监控'
        nextActionHref = policyHref(policy.id)
        healthHint = '保障即将截止，请关注结算窗口与头寸状态'
      } else if (policy.status === 'active') {
        nextActionLabel = '打开保单'
        nextActionHref = policyHref(policy.id)
        healthHint = '保障生效中'
      }
    }

    if (event.kind === 'opened') {
      nextActionLabel = nextActionLabel ?? '打开保单'
      nextActionHref = nextActionHref ?? (policyId ? policyHref(policyId) : undefined)
      healthHint = healthHint ?? '出资开保已完成'
    }

    if (event.kind === 'settled') {
      urgency = 'low'
      nextActionLabel = '查看保单'
      nextActionHref = policyId ? policyHref(policyId) : undefined
      if (policy && !policy.hasNft) {
        healthHint = '结算完成 · 可铸造保单 NFT'
        nextActionLabel = '查看 NFT'
        nextActionHref = policyHref(policy.id, 'nft')
      } else {
        healthHint = '结算完成'
      }
    }

    const meta = [...money.meta]
    if (event.kind === 'opened' && policy?.openedAt) {
      meta.unshift(`开保 ${localDateKey(policy.openedAt, date)}`)
    }
    if (policy?.coverageEnd && event.kind !== 'opened') {
      meta.push(`截止 ${localDateKey(policy.coverageEnd, date)}`)
    }
    if (countdown && (kind === 'coverage_end' || kind === 'settle')) {
      meta.push(countdown === '已到期' ? '已到期' : `剩余 ${countdown}`)
    }
    if (policy?.hasNft) meta.push('已铸 NFT')

    const primaryHref =
      nextActionHref ??
      (agent ? taskHref(agent.id) : undefined) ??
      event.href ??
      (policyId ? policyHref(policyId) : undefined)

    const actions = primaryHref
      ? buildActions(
          { label: nextActionLabel ?? '打开', href: primaryHref, primary: true },
          [
            policyId
              ? { label: '保单详情', href: policyHref(policyId) }
              : null,
            agent ? { label: 'Agent 任务', href: taskHref(agent.id) } : null,
            policy && (policy.status === 'proposed' || policy.status === 'funded')
              ? { label: '前往金库核资', href: '/vault' }
              : null,
            policy &&
            (policy.status === 'active' || policy.status === 'settled') &&
            !policy.hasNft
              ? { label: '铸造 NFT', href: policyHref(policy.id, 'nft') }
              : null,
          ].filter(Boolean) as ScheduleAction[]
        )
      : undefined

    return [
      {
        id: event.id,
        title: policy?.title ?? event.label,
        date,
        color,
        kind,
        allDay: true as const,
        href: primaryHref,
        kindLabel,
        subtitle:
          [money.tier, policy?.status ? policy.status : null]
            .filter(Boolean)
            .join(' · ') || undefined,
        meta,
        status: policy?.status,
        policyId,
        agentTaskId: agent?.id,
        txHash: event.kind === 'opened' ? policy?.openTx ?? undefined : undefined,
        goalSnippet: goalSnippetFromTask(agent),
        tierLabel: money.tier ?? undefined,
        premiumLabel: money.premiumLabel,
        payoutLabel: money.payoutLabel,
        countdown:
          kind === 'coverage_end' || kind === 'settle' ? countdown : null,
        urgency,
        nextActionLabel,
        nextActionHref: primaryHref,
        healthHint,
        actions,
      },
    ]
  })
}

/** Actionable nodes derived from policy + agent state (not just coverage dates). */
export function actionableEventsFromProduct(
  policies: PolicyListItem[],
  agentTasks: AgentTaskListItem[],
  nowMs: number
): ScheduleEvent[] {
  const today = todayKeyFromMs(nowMs)
  const agentByPolicy = new Map<string, AgentTaskListItem>()
  for (const task of agentTasks) {
    if (task.archivedAt) continue
    if (task.primaryRefType === 'policy' && task.primaryRefId) {
      agentByPolicy.set(task.primaryRefId, task)
    }
  }

  const events: ScheduleEvent[] = []
  const seen = new Set<string>()

  const push = (event: ScheduleEvent) => {
    if (seen.has(event.id)) return
    seen.add(event.id)
    events.push(event)
  }

  for (const policy of policies) {
    const money = moneyMeta(policy)
    const agent = agentByPolicy.get(policy.id)
    const goal = goalSnippetFromTask(agent)

    if (policy.status === 'proposed' || policy.status === 'funded') {
      const href = agent ? taskHref(agent.id) : policyHref(policy.id)
      push({
        id: `${policy.id}-funding`,
        title: policy.title,
        date: localDateKey(policy.updatedAt, today),
        color: KIND_COLOR.funding,
        kind: 'funding',
        allDay: true,
        href,
        policyId: policy.id,
        agentTaskId: agent?.id,
        kindLabel: KIND_LABEL.funding,
        subtitle: [money.tier, policy.status].filter(Boolean).join(' · '),
        meta: [...money.meta, '等待出资开保'],
        status: policy.status,
        goalSnippet: goal,
        tierLabel: money.tier ?? undefined,
        premiumLabel: money.premiumLabel,
        payoutLabel: money.payoutLabel,
        urgency: 'high',
        nextActionLabel: agent ? '继续任务并出资' : '选择方案并出资',
        nextActionHref: href,
        healthHint:
          policy.status === 'funded'
            ? '已标记出资，请确认链上开保'
            : '方案已生成，待选择档位并出资',
        actions: buildActions(
          { label: agent ? '打开 Agent 任务' : '打开保单出资', href, primary: true },
          [
            { label: '保单详情', href: policyHref(policy.id) },
            { label: '前往金库核资', href: '/vault' },
          ]
        ),
      })
    }

    if (
      (policy.status === 'intake' || policy.status === 'composing') &&
      agent &&
      (agent.status === 'waiting_user' || agent.status === 'running')
    ) {
      const href = taskHref(agent.id)
      const agentDesc = agent.description ?? statusHint(agent.status)
      push({
        id: `${policy.id}-intake`,
        title: policy.title,
        date: localDateKey(agent.updatedAt ?? policy.updatedAt, today),
        color: KIND_COLOR.agent,
        kind: 'agent',
        allDay: true,
        href,
        policyId: policy.id,
        agentTaskId: agent.id,
        kindLabel: agent.status === 'waiting_user' ? '等待你' : '编排中',
        subtitle: agentDesc,
        meta: agent.description
          ? [agent.description, statusHint(agent.status)]
          : [statusHint(agent.status)],
        status: policy.status,
        goalSnippet: goal,
        urgency: agent.status === 'waiting_user' ? 'high' : 'medium',
        nextActionLabel:
          agent.status === 'waiting_user' ? '确认问卷 / 选档' : '查看编排进度',
        nextActionHref: href,
        healthHint:
          agent.description ??
          (agent.status === 'waiting_user'
            ? '任务等待你的确认（问卷或方案选择）'
            : 'Agent 正在检索市场并编排方案'),
        actions: buildActions(
          { label: '打开 Agent 任务', href, primary: true },
          [{ label: '保单详情', href: policyHref(policy.id) }]
        ),
      })
    }

    // NFT：仅在已结算且未铸造时落入日历，避免生效保单日程被刷屏
    if (policy.status === 'settled' && !policy.hasNft) {
      push({
        id: `${policy.id}-nft`,
        title: policy.title,
        date: localDateKey(policy.updatedAt, today),
        color: KIND_COLOR.nft,
        kind: 'nft',
        allDay: true,
        href: policyHref(policy.id, 'nft'),
        policyId: policy.id,
        agentTaskId: agent?.id,
        kindLabel: KIND_LABEL.nft,
        subtitle: '可铸造保单 NFT',
        meta: [...money.meta, '尚未铸造'],
        status: policy.status,
        goalSnippet: goal,
        tierLabel: money.tier ?? undefined,
        urgency: 'low',
        nextActionLabel: '打开 NFT',
        nextActionHref: policyHref(policy.id, 'nft'),
        healthHint: '已结算保单可铸造纪念 NFT',
        actions: buildActions(
          {
            label: '打开 NFT 页签',
            href: policyHref(policy.id, 'nft'),
            primary: true,
          },
          [
            { label: '保单详情', href: policyHref(policy.id) },
            { label: '藏品库', href: '/collection' },
          ]
        ),
      })
    }
  }

  // Agent tasks waiting on user that are not already covered via policy loop
  for (const task of agentTasks) {
    if (task.archivedAt) continue
    if (task.status !== 'waiting_user' && task.status !== 'monitoring') continue

    const policyId =
      task.primaryRefType === 'policy' ? task.primaryRefId ?? undefined : undefined
    if (policyId && seen.has(`${policyId}-intake`)) continue
    if (policyId && seen.has(`${policyId}-funding`)) continue

    if (task.status === 'waiting_user') {
      push({
        id: `task-${task.id}-wait`,
        title: task.title || 'Agent 任务',
        date: localDateKey(task.updatedAt, today),
        color: KIND_COLOR.agent,
        kind: 'agent',
        allDay: true,
        href: taskHref(task.id),
        policyId,
        agentTaskId: task.id,
        kindLabel: '等待你',
        subtitle: task.description ?? statusHint(task.status),
        meta: task.description
          ? [task.description, '确认问卷 / 选择方案 / 出资确认']
          : ['确认问卷 / 选择方案 / 出资确认'],
        goalSnippet: goalSnippetFromTask(task),
        urgency: 'high',
        nextActionLabel: '打开任务',
        nextActionHref: taskHref(task.id),
        healthHint: '任务处于 waiting_user，需要你的下一步操作',
        actions: buildActions(
          { label: '打开 Agent 任务', href: taskHref(task.id), primary: true },
          policyId
            ? [{ label: '关联保单', href: policyHref(policyId) }]
            : []
        ),
      })
    }

    if (task.status === 'monitoring' && policyId) {
      push({
        id: `task-${task.id}-monitor`,
        title: task.title || '保障监控',
        date: localDateKey(task.updatedAt, today),
        color: KIND_COLOR.attention,
        kind: 'attention',
        allDay: true,
        href: taskHref(task.id),
        policyId,
        agentTaskId: task.id,
        kindLabel: '监控中',
        subtitle: task.description ?? statusHint(task.status),
        meta: task.description ? [task.description, '持续监控'] : ['持续监控'],
        goalSnippet: goalSnippetFromTask(task),
        urgency: 'low',
        nextActionLabel: '查看监控任务',
        nextActionHref: taskHref(task.id),
        healthHint: task.description ?? '保障生效后 Agent 处于监控态',
        actions: buildActions(
          { label: '打开 Agent 任务', href: taskHref(task.id), primary: true },
          [{ label: '保单详情', href: policyHref(policyId) }]
        ),
      })
    }
  }

  return events
}

export type ScheduleDataMode = 'live' | 'empty' | 'demo' | 'error'

export interface ScheduleObservabilitySummary {
  pendingFund: number
  awaitingSettle: number
  waitingUser: number
  monitoring: number
  endingSoon: number
  activeCoverage: number
  settled: number
  mintableNft: number
}

export function summarizeScheduleState(
  policies: PolicyListItem[],
  agentTasks: AgentTaskListItem[],
  nowMs: number
): ScheduleObservabilitySummary {
  let pendingFund = 0
  let awaitingSettle = 0
  let endingSoon = 0
  let activeCoverage = 0
  let settled = 0
  let mintableNft = 0

  for (const p of policies) {
    if (p.status === 'proposed' || p.status === 'funded') pendingFund += 1
    if (p.status === 'active') {
      activeCoverage += 1
      if (isCoverageExpired(p.coverageEnd, nowMs)) awaitingSettle += 1
      else if (isCoverageWithinDays(p.coverageEnd, 14, nowMs)) endingSoon += 1
    }
    if (p.status === 'settled') settled += 1
    if (
      (p.status === 'active' || p.status === 'settled') &&
      !p.hasNft
    ) {
      mintableNft += 1
    }
  }

  let waitingUser = 0
  let monitoring = 0
  for (const t of agentTasks) {
    if (t.archivedAt) continue
    if (t.status === 'waiting_user') waitingUser += 1
    if (t.status === 'monitoring') monitoring += 1
  }

  return {
    pendingFund,
    awaitingSettle,
    waitingUser,
    monitoring,
    endingSoon,
    activeCoverage,
    settled,
    mintableNft,
  }
}

const WATCH_COLOR_FALLBACK = 'blue'

function watchEventId(itemId: string): string {
  return `watch-${itemId}`
}

function watchDueKey(
  item: ScheduleWatchItem,
  nowMs: number
): string | null {
  if (!item.dueOn) return null
  return localDateKey(item.dueOn, todayKeyFromMs(nowMs))
}

function watchUrgency(
  item: ScheduleWatchItem,
  nowMs: number
): ScheduleUrgency {
  if (!item.dueOn) return 'medium'
  const due = localDateKey(item.dueOn, todayKeyFromMs(nowMs))
  const today = todayKeyFromMs(nowMs)
  if (due < today) return 'critical'
  if (due === today) return 'high'
  if (isCoverageWithinDays(`${due}T12:00:00`, 7, nowMs)) return 'high'
  if (isCoverageWithinDays(`${due}T12:00:00`, 14, nowMs)) return 'medium'
  return 'low'
}

/** Map custom watch items onto calendar days (only items with due_on). */
export function eventsFromWatchItems(
  items: ScheduleWatchItem[],
  nowMs: number = Date.now()
): ScheduleEvent[] {
  const events: ScheduleEvent[] = []
  for (const item of items) {
    if (item.archivedAt) continue
    const date = watchDueKey(item, nowMs)
    if (!date) continue
    const urgency = watchUrgency(item, nowMs)
    const overdue = urgency === 'critical'
    const color = item.color || WATCH_COLOR_FALLBACK
    const href =
      item.href ??
      (item.policyId ? policyHref(item.policyId) : undefined)
    events.push({
      id: watchEventId(item.id),
      title: item.title,
      date,
      color,
      kind: 'custom',
      allDay: true,
      href,
      policyId: item.policyId ?? undefined,
      watchItemId: item.id,
      kindLabel: KIND_LABEL.custom,
      subtitle:
        item.notes ?? (item.policyId ? '关联保单关注' : '自定义关注'),
      meta: item.notes
        ? [item.notes]
        : [item.policyId ? '已关联保单' : '自定义关注事项'],
      urgency,
      countdown: overdue
        ? '已到期'
        : formatCountdown(`${date}T12:00:00`),
      nextActionLabel: href
        ? item.policyId
          ? '打开保单'
          : '打开链接'
        : '查看详情',
      nextActionHref: href,
      healthHint: overdue
        ? '自定义关注已到期'
        : item.notes ??
          (item.policyId ? '已关联保单的关注事项' : '你添加的关注事项'),
      actions: href
        ? buildActions({
            label: item.policyId ? '打开保单' : '打开链接',
            href,
            primary: true,
          })
        : undefined,
    })
  }
  return events
}

export function resolveScheduleEvents(input: {
  policyEvents: PolicyCalendarEvent[]
  policies: PolicyListItem[]
  agentTasks: AgentTaskListItem[]
  nowMs: number
  anchor: Date
  /** True when policies query failed and we have no list to show. */
  policiesFailed?: boolean
  watchItems?: ScheduleWatchItem[]
}): { events: ScheduleEvent[]; mode: ScheduleDataMode } {
  const {
    policyEvents,
    policies,
    agentTasks,
    nowMs,
    anchor,
    policiesFailed = false,
    watchItems = [],
  } = input

  const agentByPolicy = new Map<string, AgentTaskListItem>()
  for (const task of agentTasks) {
    if (task.archivedAt) continue
    if (task.primaryRefType === 'policy' && task.primaryRefId) {
      agentByPolicy.set(task.primaryRefId, task)
    }
  }

  const calendarMapped = scheduleEventsFromPolicyCalendar(
    policyEvents,
    policies,
    agentByPolicy,
    nowMs
  )
  const actionable = actionableEventsFromProduct(policies, agentTasks, nowMs)
  const custom = eventsFromWatchItems(watchItems, nowMs)

  const byId = new Map<string, ScheduleEvent>()
  for (const event of [...calendarMapped, ...actionable, ...custom]) {
    const prev = byId.get(event.id)
    if (!prev || URGENCY_RANK[event.urgency ?? 'low'] < URGENCY_RANK[prev.urgency ?? 'low']) {
      byId.set(event.id, event)
    }
  }

  const events = [...byId.values()].sort((a, b) => {
    const urgencyDiff =
      URGENCY_RANK[a.urgency ?? 'low'] - URGENCY_RANK[b.urgency ?? 'low']
    if (urgencyDiff !== 0) return urgencyDiff
    return a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
  })

  if (events.length > 0) {
    return { events, mode: 'live' }
  }

  // API succeeded with no product surface → guide empty state (no fake calendar fill).
  if (!policiesFailed) {
    return { events: [], mode: 'empty' }
  }

  // Last-resort soft demo when the list API is unavailable.
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 })
  return { events: buildDemoScheduleEvents(weekStart), mode: 'demo' }
}

export type ScheduleAttentionTask = ScheduleTaskCardProps & {
  href: string
  policyId?: string
  agentTaskId?: string
  watchItemId?: string
  eventId?: string
  eventDate?: string
  urgency: ScheduleUrgency
  actionLabel: string
  source?: 'system' | 'custom'
}

/** 左栏关注项：问卷确认 / 选档出资 / 将截止 / 待结算 / Agent 等待 / NFT */
export function tasksFromPolicies(
  policies: PolicyListItem[],
  agentTasks: AgentTaskListItem[],
  nowMs: number
): ScheduleAttentionTask[] {
  const tasks: ScheduleAttentionTask[] = []
  const agentByPolicy = new Map<string, AgentTaskListItem>()
  for (const task of agentTasks) {
    if (task.archivedAt) continue
    if (task.primaryRefType === 'policy' && task.primaryRefId) {
      agentByPolicy.set(task.primaryRefId, task)
    }
  }

  const coveredTaskIds = new Set<string>()

  for (const p of policies) {
    const money = moneyMeta(p)
    const agent = agentByPolicy.get(p.id)
    const goal = goalSnippetFromTask(agent)
    const coverageEvent =
      p.coverageEnd != null
        ? {
            eventId: `${p.id}-coverage`,
            eventDate: localDateKey(p.coverageEnd, todayKeyFromMs(nowMs)),
          }
        : {}
    const countdown = formatCountdown(p.coverageEnd)

    if (p.status === 'proposed' || p.status === 'funded') {
      const href = agent ? taskHref(agent.id) : policyHref(p.id)
      if (agent) coveredTaskIds.add(agent.id)
      tasks.push({
        title: p.title,
        description:
          goal ??
          (p.status === 'funded'
            ? '出资已准备，请完成链上开保确认'
            : '方案已生成，请选择档位并出资开保'),
        tags: [
          {
            label: '待出资',
            bg: 'bg-[color-mix(in_srgb,var(--units-orange)_22%,transparent)]',
            text: 'text-[var(--units-orange)]',
          },
        ],
        dueDate: coverageEvent.eventDate ?? '尽快',
        progress: { completed: 1, total: 3 },
        href,
        policyId: p.id,
        agentTaskId: agent?.id,
        status: p.status,
        fields: money.meta,
        urgency: 'high',
        actionLabel: agent ? '继续任务' : '去出资',
        countdown: null,
        healthHint: money.tier ? `${money.tier}方案待确认` : '待选择保障档位',
        eventId: `${p.id}-funding`,
        eventDate: localDateKey(p.updatedAt, todayKeyFromMs(nowMs)),
      })
    }

    if (
      (p.status === 'intake' || p.status === 'composing') &&
      agent?.status === 'waiting_user'
    ) {
      coveredTaskIds.add(agent.id)
      tasks.push({
        title: p.title,
        description: agent.description ?? goal ?? '任务等待你确认问卷或方案选择',
        tags: [
          {
            label: '等待你',
            bg: 'bg-[color-mix(in_srgb,var(--units-lilac)_28%,transparent)]',
            text: 'text-[var(--units-lilac)]',
          },
        ],
        dueDate: '尽快',
        progress: { completed: 0, total: 3 },
        href: taskHref(agent.id),
        policyId: p.id,
        agentTaskId: agent.id,
        status: p.status,
        fields: [statusHint(agent.status)],
        urgency: 'high',
        actionLabel: '确认问卷',
        healthHint: agent.description ?? 'Agent 停留在 waiting_user',
        eventId: `${p.id}-intake`,
        eventDate: localDateKey(agent.updatedAt, todayKeyFromMs(nowMs)),
      })
    }

    if (p.status === 'active' && p.coverageEnd) {
      const expired = isCoverageExpired(p.coverageEnd, nowMs)
      const due = localDateKey(p.coverageEnd, todayKeyFromMs(nowMs))
      if (expired) {
        tasks.push({
          title: p.title,
          description: goal ?? '保障已到期，请核对 Oracle / 结算进度',
          tags: [
            {
              label: '待结算',
              bg: 'bg-[color-mix(in_srgb,var(--units-yellow)_28%,transparent)]',
              text: 'text-[var(--units-on-accent)]',
            },
          ],
          dueDate: due,
          progress: { completed: 2, total: 3 },
          overdue: true,
          href: policyHref(p.id),
          policyId: p.id,
          agentTaskId: agent?.id,
          eventId: `${p.id}-coverage`,
          eventDate: due,
          status: p.status,
          fields: money.meta,
          urgency: 'critical',
          actionLabel: '查看结算',
          countdown: '已到期',
          healthHint: '保障期结束 · 优先处理结算窗口',
        })
      } else if (isCoverageWithinDays(p.coverageEnd, 14, nowMs)) {
        tasks.push({
          title: p.title,
          description: goal ?? '保障即将截止，请关注结算窗口与风险信号',
          tags: [
            {
              label: '将截止',
              bg: 'bg-[color-mix(in_srgb,var(--units-blue)_18%,transparent)]',
              text: 'text-[var(--units-blue)]',
            },
          ],
          dueDate: due,
          progress: { completed: 2, total: 3 },
          href: policyHref(p.id),
          policyId: p.id,
          agentTaskId: agent?.id,
          eventId: `${p.id}-coverage`,
          eventDate: due,
          status: p.status,
          fields: money.meta,
          urgency: isCoverageWithinDays(p.coverageEnd, 7, nowMs)
            ? 'high'
            : 'medium',
          actionLabel: '查看监控',
          countdown,
          healthHint: countdown ? `剩余 ${countdown}` : '临近保障截止',
        })
      }
    }

    if (p.status === 'settled' && !p.hasNft) {
      tasks.push({
        title: p.title,
        description: '结算完成，可铸造保单 NFT',
        tags: [
          {
            label: '可铸 NFT',
            bg: 'bg-[color-mix(in_srgb,var(--units-green)_18%,transparent)]',
            text: 'text-[var(--units-green)]',
          },
        ],
        dueDate: localDateKey(p.updatedAt, todayKeyFromMs(nowMs)),
        progress: { completed: 3, total: 3 },
        href: policyHref(p.id, 'nft'),
        policyId: p.id,
        agentTaskId: agent?.id,
        eventId: `${p.id}-nft`,
        eventDate: localDateKey(p.updatedAt, todayKeyFromMs(nowMs)),
        status: p.status,
        fields: money.meta,
        urgency: 'low',
        actionLabel: '打开 NFT',
        healthHint: '已结算 · NFT 未铸造',
      })
    }
  }

  for (const task of agentTasks) {
    if (task.archivedAt) continue
    if (coveredTaskIds.has(task.id)) continue
    if (task.status !== 'waiting_user') continue

    const policyId =
      task.primaryRefType === 'policy' ? task.primaryRefId ?? undefined : undefined

    tasks.push({
      title: task.title || 'Agent 任务',
      description: task.description ?? goalSnippetFromTask(task) ?? '任务等待你的操作',
      tags: [
        {
          label: '等待你',
          bg: 'bg-[color-mix(in_srgb,var(--units-lilac)_28%,transparent)]',
          text: 'text-[var(--units-lilac)]',
        },
      ],
      dueDate: '尽快',
      progress: { completed: 0, total: 3 },
      href: taskHref(task.id),
      policyId,
      agentTaskId: task.id,
      eventId: `task-${task.id}-wait`,
      eventDate: localDateKey(task.updatedAt, todayKeyFromMs(nowMs)),
      fields: [statusHint(task.status)],
      urgency: 'high',
      actionLabel: '打开任务',
      healthHint: 'waiting_user · 确认问卷 / 选档 / 出资',
    })
  }

  return tasks.sort((a, b) => {
    const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgencyDiff !== 0) return urgencyDiff
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  })
}

/** Left-rail cards for user-authored watch items. */
export function tasksFromWatchItems(
  items: ScheduleWatchItem[],
  nowMs: number
): ScheduleAttentionTask[] {
  const tasks: ScheduleAttentionTask[] = []
  const today = todayKeyFromMs(nowMs)

  for (const item of items) {
    if (item.archivedAt) continue
    const due = watchDueKey(item, nowMs)
    const urgency = watchUrgency(item, nowMs)
    const overdue = Boolean(due && due < today)
    const href =
      item.href ??
      (item.policyId ? policyHref(item.policyId) : `/schedule`)
    const countdown = due
      ? overdue
        ? '已到期'
        : formatCountdown(`${due}T12:00:00`)
      : null

    const tags = [
      {
        label: '我的关注',
        bg: 'bg-[color-mix(in_srgb,var(--units-blue)_18%,transparent)]',
        text: 'text-[var(--units-blue)]',
      },
    ]
    if (item.policyId) {
      tags.push({
        label: '关联保单',
        bg: 'bg-[color-mix(in_srgb,var(--units-green)_18%,transparent)]',
        text: 'text-[var(--units-green)]',
      })
    }

    tasks.push({
      title: item.title,
      description:
        item.notes?.trim() ||
        (item.policyId ? '已关联保单' : '自定义关注事项'),
      tags,
      dueDate: due ?? '未设日期',
      progress: { completed: overdue ? 0 : 1, total: 2 },
      overdue,
      href,
      policyId: item.policyId ?? undefined,
      watchItemId: item.id,
      eventId: due ? watchEventId(item.id) : undefined,
      eventDate: due ?? undefined,
      fields: due
        ? [`日期 ${due}`]
        : item.policyId
          ? ['已关联保单']
          : ['未绑定日历日'],
      urgency,
      actionLabel: due ? '定位日程' : '编辑关注',
      countdown,
      healthHint: overdue
        ? '已过期 · 可编辑或删除'
        : item.policyId
          ? '已关联保单 · 可随时调整'
          : '自定义关注 · 可随时调整',
      source: 'custom',
    })
  }

  return tasks.sort((a, b) => {
    const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgencyDiff !== 0) return urgencyDiff
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  })
}

/** Merge system-derived attention with custom watch items (custom first by urgency). */
export function mergeAttentionTasks(
  systemTasks: ScheduleAttentionTask[],
  watchTasks: ScheduleAttentionTask[]
): ScheduleAttentionTask[] {
  return [...watchTasks, ...systemTasks].sort((a, b) => {
    const urgencyDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgencyDiff !== 0) return urgencyDiff
    // Custom items with same urgency stay above system peers when due earlier.
    if (a.source === 'custom' && b.source !== 'custom') return -1
    if (a.source !== 'custom' && b.source === 'custom') return 1
    return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  })
}
