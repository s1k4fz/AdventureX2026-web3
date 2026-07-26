import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/apiClient'
import { retryUnlessClientError, signOutOn401 } from '@/lib/apiUtils'

export interface ScheduleWatchItem {
  id: string
  title: string
  notes: string | null
  dueOn: string | null
  href: string | null
  policyId: string | null
  color: string
  sortOrder: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ScheduleWatchItemColor =
  | 'blue'
  | 'lilac'
  | 'orange'
  | 'green'
  | 'yellow'
  | 'red'

export interface ScheduleWatchItemCreateInput {
  title: string
  notes?: string | null
  dueOn?: string | null
  href?: string | null
  policyId?: string | null
  color?: ScheduleWatchItemColor
}

export interface ScheduleWatchItemUpdateInput {
  title?: string
  notes?: string | null
  dueOn?: string | null
  clearDueOn?: boolean
  href?: string | null
  clearHref?: boolean
  policyId?: string | null
  clearPolicyId?: boolean
  color?: ScheduleWatchItemColor
  archived?: boolean
}

export const scheduleWatchItemsQueryKey = ['schedule-watch-items'] as const

async function listWatchItems(): Promise<ScheduleWatchItem[]> {
  const { data } = await signOutOn401(
    apiClient.get<ScheduleWatchItem[]>('/api/v1/schedule-watch-items', {
      params: { limit: 100 },
    })
  )
  return data
}

export function useScheduleWatchItemsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: scheduleWatchItemsQueryKey,
    queryFn: listWatchItems,
    retry: retryUnlessClientError,
    enabled: options?.enabled,
  })
}

export function useCreateScheduleWatchItemMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: ScheduleWatchItemCreateInput) => {
      const { data } = await signOutOn401(
        apiClient.post<ScheduleWatchItem>(
          '/api/v1/schedule-watch-items',
          variables
        )
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleWatchItemsQueryKey,
      })
    },
  })
}

export function useUpdateScheduleWatchItemMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: {
      itemId: string
    } & ScheduleWatchItemUpdateInput) => {
      const { itemId, ...body } = variables
      const { data } = await signOutOn401(
        apiClient.patch<ScheduleWatchItem>(
          `/api/v1/schedule-watch-items/${itemId}`,
          body
        )
      )
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleWatchItemsQueryKey,
      })
    },
  })
}

export function useDeleteScheduleWatchItemMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: { itemId: string }) => {
      await signOutOn401(
        apiClient.delete(`/api/v1/schedule-watch-items/${variables.itemId}`)
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleWatchItemsQueryKey,
      })
    },
  })
}
