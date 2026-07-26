const LOGIN_REDIRECT_KEY = 'xengine.loginRedirect'

/** Persist post-login path across the Google OAuth round-trip. */
export function stashLoginRedirect(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/login')) {
    return
  }
  sessionStorage.setItem(LOGIN_REDIRECT_KEY, path)
}

/** Read and clear the stashed path; falls back when missing/invalid. */
export function takeLoginRedirect(fallback = '/home') {
  const stored = sessionStorage.getItem(LOGIN_REDIRECT_KEY)
  sessionStorage.removeItem(LOGIN_REDIRECT_KEY)
  if (
    !stored ||
    !stored.startsWith('/') ||
    stored.startsWith('//') ||
    stored.startsWith('/login')
  ) {
    return fallback
  }
  return stored
}
