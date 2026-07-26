import { useAuth } from '@/features/auth/useAuth'

/**
 * Check if the current user has the admin role.
 * Demo mode: every logged-in user is treated as admin (mirrors the backend
 * override in core/security.py). Restore the app_metadata.role check when
 * leaving demo mode.
 */
export function useIsAdmin(): boolean {
  const { session } = useAuth()
  return Boolean(session?.user)
}
