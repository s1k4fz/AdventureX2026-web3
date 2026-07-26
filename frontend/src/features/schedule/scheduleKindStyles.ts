import type { ScheduleEventKind } from './types'

/** Units 色名 → 日历色块背景 class */
export const SCHEDULE_COLOR_BG: Record<string, string> = {
  blue: 'bg-[var(--units-blue)]',
  violet: 'bg-[var(--units-lilac)]',
  amber: 'bg-[var(--units-yellow)]',
  sky: 'bg-[var(--units-blue)]',
  emerald: 'bg-[var(--units-green)]',
  orange: 'bg-[var(--units-orange)]',
  rose: 'bg-[var(--units-red)]',
  cyan: 'bg-[var(--units-blue)]',
  fuchsia: 'bg-[var(--units-lilac)]',
  green: 'bg-[var(--units-green)]',
  yellow: 'bg-[var(--units-yellow)]',
  lilac: 'bg-[var(--units-lilac)]',
  red: 'bg-[var(--units-red)]',
}

export const KIND_COLOR: Record<ScheduleEventKind, string> = {
  coverage_end: 'amber',
  resolution: 'blue',
  opened: 'emerald',
  settled: 'green',
  created: 'lilac',
  attention: 'orange',
  funding: 'orange',
  settle: 'amber',
  agent: 'lilac',
  nft: 'green',
  custom: 'blue',
}

export const KIND_LABEL: Record<ScheduleEventKind, string> = {
  coverage_end: '保障截止',
  resolution: '市场到期',
  opened: '出资开保',
  settled: '结算完成',
  created: '创建',
  attention: '待办',
  funding: '待出资',
  settle: '待结算',
  agent: 'Agent 任务',
  nft: 'NFT',
  custom: '我的关注',
}

export const KIND_DOT: Record<ScheduleEventKind, string> = {
  coverage_end: 'bg-[var(--units-yellow)]',
  resolution: 'bg-[var(--units-blue)]',
  opened: 'bg-[var(--units-green)]',
  settled: 'bg-[var(--units-green)]',
  created: 'bg-[var(--units-lilac)]',
  attention: 'bg-[var(--units-orange)]',
  funding: 'bg-[var(--units-orange)]',
  settle: 'bg-[var(--units-yellow)]',
  agent: 'bg-[var(--units-lilac)]',
  nft: 'bg-[var(--units-green)]',
  custom: 'bg-[var(--units-blue)]',
}

export function inkOnAccent(color: string): string {
  return color === 'amber' || color === 'yellow'
    ? 'text-[var(--units-on-accent)]'
    : 'text-white'
}

export const SCHEDULE_LEGEND: Array<{ kind: ScheduleEventKind; label: string }> =
  [
    { kind: 'funding', label: KIND_LABEL.funding },
    { kind: 'settle', label: KIND_LABEL.settle },
    { kind: 'coverage_end', label: KIND_LABEL.coverage_end },
    { kind: 'agent', label: KIND_LABEL.agent },
    { kind: 'settled', label: KIND_LABEL.settled },
  ]
