import type { AgentTaskStatus } from './types'

export type AgentTaskSidebarGroup =
  | '等待你'
  | '进行中'
  | '需关注'
  | '已完成'

export function groupLabel(status: AgentTaskStatus): AgentTaskSidebarGroup {
  if (status === 'waiting_user') return '等待你'
  if (status === 'failed') return '需关注'
  if (status === 'succeeded' || status === 'cancelled') return '已完成'
  // draft / running / monitoring stay in progress
  return '进行中'
}

export function statusHint(status: AgentTaskStatus): string {
  switch (status) {
    case 'waiting_user':
      return '等待你的操作'
    case 'running':
      return '正在推进'
    case 'monitoring':
      return '保障监控中'
    case 'failed':
      return '需要关注'
    case 'succeeded':
      return '已完成'
    case 'cancelled':
      return '已取消'
    case 'draft':
      return '草稿'
    default:
      return ''
  }
}

export const SIDEBAR_GROUP_ORDER: AgentTaskSidebarGroup[] = [
  '等待你',
  '进行中',
  '需关注',
  '已完成',
]
