import { useAuth } from '@/features/auth/useAuth'

/**
 * Check if the current user has the admin role.
 * Reads from the Supabase session JWT's app_metadata.role field.
 */
export function useIsAdmin(): boolean {
  const { session } = useAuth()
  if (!session?.user) return false
  const appMetadata = session.user.app_metadata
  return appMetadata?.role === 'admin'
}
