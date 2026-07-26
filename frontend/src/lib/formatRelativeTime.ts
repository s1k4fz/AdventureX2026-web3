/** Compact relative time for sidebar rows (zh-CN). */
export function formatRelativeTime(
  iso: string,
  referenceTimeMs: number = Date.now()
): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''

  const diffMs = referenceTimeMs - then
  if (diffMs < 0) return '刚刚'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`

  const date = new Date(then)
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === new Date(referenceTimeMs).getFullYear()) {
    return `${month}/${day}`
  }
  return `${date.getFullYear()}/${month}/${day}`
}
