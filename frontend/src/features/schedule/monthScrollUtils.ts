import { addMonths, format, startOfMonth } from 'date-fns'

export function toMonthKey(date: Date): string {
  return format(startOfMonth(date), 'yyyy-MM')
}

export function buildMonthRange(center: Date, before: number, after: number): Date[] {
  const start = startOfMonth(center)
  const months: Date[] = []
  for (let i = -before; i <= after; i++) {
    months.push(addMonths(start, i))
  }
  return months
}

export function monthKeyEquals(a: Date, b: Date): boolean {
  return toMonthKey(a) === toMonthKey(b)
}
