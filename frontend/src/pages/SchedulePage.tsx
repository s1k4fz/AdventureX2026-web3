import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CircleCheckBig,
  Ellipsis,
  Pencil,
  Plus,
  Trash2,
  Vault,
} from 'lucide-react'
import { format, parseISO, startOfMonth } from 'date-fns'
import { zhCN } from 'date-fns/locale'

import { CircularProgress } from '@/components/CircularProgress'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { PageReveal } from '@/components/PageReveal'
import { useAgentTasksQuery } from '@/features/agent/agentApi'
import { ScheduleAgendaView } from '@/features/schedule/ScheduleAgendaView'
import { ScheduleDayView } from '@/features/schedule/ScheduleDayView'
import { ScheduleEventDetailSheet } from '@/features/schedule/ScheduleEventDetailSheet'
import { ScheduleMonthView } from '@/features/schedule/ScheduleMonthView'
import { ScheduleToolbar } from '@/features/schedule/ScheduleToolbar'
import { ScheduleViewTransition } from '@/features/schedule/ScheduleViewTransition'
import { ScheduleWatchItemDialog } from '@/features/schedule/ScheduleWatchItemDialog'
import { ScheduleWeekView } from '@/features/schedule/ScheduleWeekView'
import { TaskCard } from '@/features/schedule/TaskCard'
import {
  mergeAttentionTasks,
  resolveScheduleEvents,
  tasksFromPolicies,
  tasksFromWatchItems,
  type ScheduleAttentionTask,
} from '@/features/schedule/policySchedule'
import {
  filterScheduleEvents,
  formatPeriodTitle,
  pickFocusMonth,
  shiftAnchor,
  toDateKey,
  weekStartFromDateKey,
} from '@/features/schedule/scheduleUtils'
import type {
  ScheduleEvent,
  ScheduleFilter,
  ScheduleView,
} from '@/features/schedule/types'
import {
  useDeleteScheduleWatchItemMutation,
  useScheduleWatchItemsQuery,
  type ScheduleWatchItem,
} from '@/features/schedule/watchItemsApi'
import { eventsFromPolicyList } from '@/features/policy/PolicyEventsCalendar'
import { usePoliciesQuery } from '@/features/policy/policyApi'
import { useReferenceTime } from '@/features/policy/policyStatus'

type SlideDirection = 'next' | 'prev' | 'none'

export function SchedulePage() {
  const policiesQuery = usePoliciesQuery()
  // Moderate polling so AI-generated titles/descriptions appear promptly
  const agentTasksQuery = useAgentTasksQuery({ refetchInterval: 15_000 })
  const watchItemsQuery = useScheduleWatchItemsQuery()
  const deleteWatchMutation = useDeleteScheduleWatchItemMutation()
  const nowMs = useReferenceTime()
  const policies = useMemo(
    () => policiesQuery.data ?? [],
    [policiesQuery.data]
  )
  const agentTasks = useMemo(
    () => agentTasksQuery.data ?? [],
    [agentTasksQuery.data]
  )
  const watchItems = useMemo(
    () => watchItemsQuery.data ?? [],
    [watchItemsQuery.data]
  )

  const [view, setView] = useState<ScheduleView>('month')
  const [filter, setFilter] = useState<ScheduleFilter>('all')
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()))
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [slideDirection, setSlideDirection] = useState<SlideDirection>('none')
  const [agendaRangeLabel, setAgendaRangeLabel] = useState<string | null>(null)
  const [autoFocusKey, setAutoFocusKey] = useState<string | null>(null)
  const [watchDialogOpen, setWatchDialogOpen] = useState(false)
  const [editingWatchItem, setEditingWatchItem] =
    useState<ScheduleWatchItem | null>(null)

  const calendarEvents = useMemo(
    () => eventsFromPolicyList(policies),
    [policies]
  )

  const { events, mode } = useMemo(
    () =>
      resolveScheduleEvents({
        policyEvents: calendarEvents,
        policies,
        agentTasks,
        watchItems,
        nowMs,
        anchor,
        policiesFailed: policiesQuery.isError,
      }),
    [
      calendarEvents,
      policies,
      agentTasks,
      watchItems,
      nowMs,
      anchor,
      policiesQuery.isError,
    ]
  )

  // Align calendar to the nearest live node once product data arrives.
  const readyFocusKey = mode === 'live' && events.length > 0 ? 'live' : null
  if (readyFocusKey && autoFocusKey !== readyFocusKey) {
    setAutoFocusKey(readyFocusKey)
    setAnchor(pickFocusMonth(events, new Date(nowMs)))
  }

  const tasks = useMemo(
    () =>
      mergeAttentionTasks(
        tasksFromPolicies(policies, agentTasks, nowMs),
        tasksFromWatchItems(watchItems, nowMs)
      ),
    [policies, agentTasks, watchItems, nowMs]
  )

  const attentionEventIds = useMemo(() => {
    const ids = new Set<string>()
    for (const task of tasks) {
      if (task.eventId) ids.add(task.eventId)
    }
    return ids
  }, [tasks])

  const visibleEvents = useMemo(
    () => filterScheduleEvents(events, filter, attentionEventIds),
    [events, filter, attentionEventIds]
  )

  const watchById = useMemo(() => {
    const map = new Map<string, ScheduleWatchItem>()
    for (const item of watchItems) map.set(item.id, item)
    return map
  }, [watchItems])

  const openCreateWatch = () => {
    setEditingWatchItem(null)
    setWatchDialogOpen(true)
  }

  const openEditWatch = (itemId: string) => {
    const item = watchById.get(itemId)
    if (!item) return
    setEditingWatchItem(item)
    setWatchDialogOpen(true)
  }

  const locateTaskOnCalendar = (task: ScheduleAttentionTask) => {
    // Custom items without a due date open the editor instead of the calendar.
    if (task.source === 'custom' && task.watchItemId && !task.eventDate) {
      openEditWatch(task.watchItemId)
      return
    }

    let targetDate = task.eventDate
    let targetEventId = task.eventId

    if (!targetEventId || !targetDate) {
      const byPolicy = task.policyId
        ? events.find((event) => event.policyId === task.policyId)
        : undefined
      if (byPolicy) {
        targetDate = byPolicy.date
        targetEventId = byPolicy.id
      }
    }

    if (targetDate) {
      setFocusDate(targetDate)
      setAnchor(weekStartFromDateKey(targetDate))
      setSlideDirection('none')
      setView('week')
    }
    if (targetEventId) {
      setFocusedEventId(targetEventId)
      const event = events.find((e) => e.id === targetEventId)
      if (event) {
        setSelectedEvent(event)
        setSheetOpen(true)
      }
    }
  }

  const openEvent = (event: ScheduleEvent) => {
    setFocusedEventId(event.id)
    setFocusDate(event.date)
    setSelectedEvent(event)
    setSheetOpen(true)
  }

  const goToDay = (day: Date) => {
    setSlideDirection('none')
    setAnchor(day)
    setFocusDate(toDateKey(day))
    setView('day')
  }

  const handleViewChange = (next: ScheduleView) => {
    setSlideDirection('none')
    setView(next)
  }

  const handleShift = (direction: -1 | 1) => {
    setSlideDirection(direction === 1 ? 'next' : 'prev')
    setAnchor((a) => shiftAnchor(view, a, direction))
  }

  const handleVisibleMonthChange = useCallback((month: Date) => {
    setAnchor(startOfMonth(month))
  }, [])

  const handleAgendaRangeChange = useCallback(
    (range: { start: string; end: string; loaded: number; total: number }) => {
      if (!range.start || !range.end) {
        setAgendaRangeLabel(null)
        return
      }
      const start = format(parseISO(range.start), 'M月d日', { locale: zhCN })
      const end = format(parseISO(range.end), 'M月d日', { locale: zhCN })
      setAgendaRangeLabel(
        `${start} – ${end} · ${range.loaded}/${range.total} 天`
      )
    },
    []
  )

  const overallDone = tasks.reduce((sum, t) => sum + t.progress.completed, 0)
  const overallTotal = tasks.reduce((sum, t) => sum + t.progress.total, 0)
  const overallPercent =
    overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0

  const periodTitle =
    view === 'agenda'
      ? (agendaRangeLabel ?? `全部 · ${visibleEvents.length} 项`)
      : formatPeriodTitle(view, anchor)

  const viewTransitionKey =
    view === 'month'
      ? 'month'
      : view === 'agenda'
        ? `agenda-${filter}`
        : `${view}-${toDateKey(anchor)}`

  const isLoading = policiesQuery.isPending

  return (
    <PageReveal className="flex h-full flex-col gap-2 lg:flex-row">
      <div className="flex max-h-[42%] shrink-0 flex-col rounded-md border border-zinc-200/80 bg-zinc-50 p-3 lg:max-h-none lg:w-82">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {overallDone === overallTotal && overallTotal > 0 ? (
              <CircleCheckBig className="size-4 text-green-500" />
            ) : (
              <CircularProgress
                value={overallPercent}
                size={14}
                strokeWidth={2}
              />
            )}
            <span className="text-sm font-medium">关注事项</span>
          </div>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="添加自定义关注"
              onClick={openCreateWatch}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              aria-label="新建风险任务"
            >
              <Link to="/tasks/new">
                <Ellipsis className="size-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="scrollbar-hidden mt-2 flex flex-1 flex-col gap-3 overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          )}
          {!isLoading && tasks.length === 0 && (
            <div className="units-stage-enter rounded-2xl border border-dashed border-[var(--units-stroke-strong)] px-3 py-6 text-center">
              <p className="text-xs leading-5 text-muted-foreground">
                {policies.length === 0
                  ? '还没有可关注的保单节点。可添加自定义关注，或创建风险任务后在此跟踪问卷、出资与结算。'
                  : '暂无紧急待办。可添加自定义关注，或等待保障截止、待出资与 Agent 等待出现在这里。'}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  className="h-8 gap-1 rounded-full px-3 text-[12px]"
                  onClick={openCreateWatch}
                >
                  <Plus className="size-3.5" />
                  添加关注
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 rounded-full px-3 text-[12px]"
                >
                  <Link to="/vault">
                    <Vault className="size-3.5" />
                    打开金库
                  </Link>
                </Button>
              </div>
            </div>
          )}
          <div className="units-stagger flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskCard
                key={
                  task.watchItemId
                    ? `watch-${task.watchItemId}`
                    : `${task.policyId ?? 'task'}-${task.agentTaskId ?? ''}-${task.title}-${task.dueDate}`
                }
                {...task}
                onClick={() => locateTaskOnCalendar(task)}
                trailingActions={
                  task.source === 'custom' && task.watchItemId ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="编辑关注"
                        className="size-7 rounded-full"
                        onClick={() => openEditWatch(task.watchItemId!)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="删除关注"
                        className="size-7 rounded-full text-muted-foreground hover:text-[var(--units-orange)]"
                        disabled={deleteWatchMutation.isPending}
                        onClick={() => {
                          if (!task.watchItemId) return
                          deleteWatchMutation.mutate({
                            itemId: task.watchItemId,
                          })
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden units-app-panel">
        <ScheduleToolbar
          view={view}
          filter={filter}
          periodTitle={periodTitle}
          onViewChange={handleViewChange}
          onFilterChange={setFilter}
          onPrev={() => handleShift(-1)}
          onNext={() => handleShift(1)}
          onToday={() => {
            const now = new Date()
            setSlideDirection('none')
            setAnchor(view === 'month' ? startOfMonth(now) : now)
            setFocusDate(toDateKey(now))
            setFocusedEventId(null)
          }}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? (
            <div className="units-stage-enter flex h-full items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : mode === 'empty' || visibleEvents.length === 0 ? (
            <div className="units-stage-enter flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                {filter !== 'all'
                  ? '当前筛选下没有节点。可切换到「全部」或「待办相关」。'
                  : policies.length === 0 && watchItems.length === 0
                    ? '暂无保障日程。创建 Agent 任务生成保单，或添加自定义关注后会出现在日历中。'
                    : '当前周期暂无节点。切换视图或筛选，或从左侧关注事项定位。'}
              </p>
              {policies.length === 0 && watchItems.length === 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    className="gap-1.5 rounded-full"
                    onClick={openCreateWatch}
                  >
                    <Plus className="size-4" />
                    添加关注
                  </Button>
                  <Button asChild className="gap-1.5 rounded-full" variant="outline">
                    <Link to="/tasks/new">
                      <Plus className="size-4" />
                      创建风险任务
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <ScheduleViewTransition
              viewKey={viewTransitionKey}
              direction={view === 'month' || view === 'agenda' ? 'none' : slideDirection}
            >
              {view === 'month' ? (
                <ScheduleMonthView
                  anchor={anchor}
                  events={visibleEvents}
                  focusedEventId={focusedEventId}
                  focusDate={focusDate}
                  onSelectDay={goToDay}
                  onVisibleMonthChange={handleVisibleMonthChange}
                />
              ) : null}
              {view === 'week' ? (
                <ScheduleWeekView
                  anchor={anchor}
                  events={visibleEvents}
                  focusedEventId={focusedEventId}
                  onSelectDay={goToDay}
                  onSelectEvent={openEvent}
                />
              ) : null}
              {view === 'day' ? (
                <ScheduleDayView
                  anchor={anchor}
                  events={visibleEvents}
                  focusedEventId={focusedEventId}
                  onSelectEvent={openEvent}
                />
              ) : null}
              {view === 'agenda' ? (
                <ScheduleAgendaView
                  events={visibleEvents}
                  anchor={anchor}
                  focusedEventId={focusedEventId}
                  onSelectEvent={openEvent}
                  onVisibleRangeChange={handleAgendaRangeChange}
                />
              ) : null}
            </ScheduleViewTransition>
          )}
        </div>
      </div>

      <ScheduleEventDetailSheet
        event={selectedEvent}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setSelectedEvent(null)
        }}
        onEditWatchItem={openEditWatch}
      />

      <ScheduleWatchItemDialog
        open={watchDialogOpen}
        onOpenChange={(open) => {
          setWatchDialogOpen(open)
          if (!open) setEditingWatchItem(null)
        }}
        editing={editingWatchItem}
      />
    </PageReveal>
  )
}
