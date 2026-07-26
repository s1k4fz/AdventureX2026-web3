import type { PolicyCalendarEventKind } from '@/features/policy/PolicyEventsCalendar'

export type ScheduleView = 'month' | 'week' | 'day' | 'agenda'

/** Schedule-only kinds extend the policy calendar vocabulary. */
export type ScheduleEventKind =
  | PolicyCalendarEventKind
  | 'attention'
  | 'funding'
  | 'settle'
  | 'agent'
  | 'nft'
  | 'custom'

export type ScheduleFilter =
  | 'all'
  | 'coverage_end'
  | 'settled'
  | 'attention'

export type ScheduleUrgency = 'critical' | 'high' | 'medium' | 'low'

export interface ScheduleAction {
  label: string
  href: string
  /** Visual emphasis in the detail sheet */
  primary?: boolean
}

/** 全日保障节点（无假时段） */
export interface ScheduleEvent {
  id: string
  title: string
  date: string
  color: string
  kind: ScheduleEventKind
  allDay: true
  href?: string
  policyId?: string
  agentTaskId?: string
  watchItemId?: string
  kindLabel?: string
  subtitle?: string
  meta?: string[]
  status?: string
  txHash?: string
  /** Short goal / need snippet when available */
  goalSnippet?: string
  tierLabel?: string
  premiumLabel?: string
  payoutLabel?: string
  countdown?: string | null
  urgency?: ScheduleUrgency
  nextActionLabel?: string
  nextActionHref?: string
  healthHint?: string
  actions?: ScheduleAction[]
}

export const SCHEDULE_VIEW_LABELS: Record<ScheduleView, string> = {
  month: '总览',
  week: '周',
  day: '日',
  agenda: '议程',
}

export const SCHEDULE_FILTER_LABELS: Record<ScheduleFilter, string> = {
  all: '全部',
  coverage_end: '保障截止',
  settled: '结算完成',
  attention: '待办相关',
}

/**
 * Soft demo events — only used when the product APIs are unavailable.
 * Prefer empty states with CTAs when the list API returns successfully.
 */
export function buildDemoScheduleEvents(weekStart: Date): ScheduleEvent[] {
  const d = (offset: number) => {
    const day = new Date(weekStart)
    day.setDate(day.getDate() + offset)
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  }
  return [
    {
      id: 'demo-1',
      title: '示例：保障截止提醒',
      date: d(0),
      color: 'amber',
      kind: 'coverage_end',
      allDay: true,
      kindLabel: '保障截止',
      subtitle: '演示保单 · 稳健型',
      meta: ['保费 $120', '最大赔付 $480', '截止即将到来'],
      status: 'active',
      policyId: 'demo-policy-1',
      urgency: 'medium',
      countdown: '3 天',
      nextActionLabel: '查看监控',
      healthHint: '演示数据 · 非真实保单',
    },
    {
      id: 'demo-2',
      title: '示例：待出资复核',
      date: d(1),
      color: 'orange',
      kind: 'funding',
      allDay: true,
      kindLabel: '待出资',
      subtitle: '方案已生成 · proposed',
      meta: ['三档待选', '保费待确认'],
      status: 'proposed',
      policyId: 'demo-policy-4',
      urgency: 'high',
      nextActionLabel: '选择方案并出资',
      healthHint: '演示数据 · 非真实保单',
    },
    {
      id: 'demo-3',
      title: '示例：Agent 等待确认',
      date: d(2),
      color: 'lilac',
      kind: 'agent',
      allDay: true,
      kindLabel: '等待你',
      subtitle: '问卷 / 选档待确认',
      meta: ['waiting_user'],
      urgency: 'high',
      nextActionLabel: '打开任务',
      healthHint: '演示数据 · 非真实任务',
    },
  ]
}
