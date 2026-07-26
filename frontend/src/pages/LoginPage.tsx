import { useMemo } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'

import { PageReveal } from '@/components/PageReveal'
import { LoginForm } from '@/features/auth/LoginForm'
import { takeLoginRedirect } from '@/features/auth/loginRedirect'
import { useAuth } from '@/features/auth/useAuth'

interface LoginLocationState {
  from?: Location
}

function pathFromLocationState(location: Location) {
  const state = location.state as LoginLocationState | null
  const from = state?.from

  if (!from) {
    return '/home'
  }

  return `${from.pathname}${from.search}${from.hash}`
}

function oauthErrorMessage(search: string) {
  const params = new URLSearchParams(search)
  const error = params.get('error')
  if (!error) {
    return null
  }
  return params.get('error_description')?.replace(/\+/g, ' ') || error
}

/** Mounted only when authed so the stash is consumed exactly once. */
function PostAuthRedirect({ fallback }: { fallback: string }) {
  const to = useMemo(() => takeLoginRedirect(fallback), [fallback])
  return <Navigate to={to} replace />
}

export function LoginPage() {
  const { status } = useAuth()
  const location = useLocation()
  const redirectPath = pathFromLocationState(location)
  const callbackError = oauthErrorMessage(location.search)

  if (status === 'loading') {
    return (
      <div
        className="relative flex min-h-svh items-center justify-center overflow-hidden bg-zinc-50"
        aria-busy="true"
        role="status"
        aria-label="正在验证会话"
      >
        <p className="relative text-sm text-muted-foreground">xEngine 启动中…</p>
      </div>
    )
  }

  if (status === 'authed') {
    return <PostAuthRedirect fallback={redirectPath} />
  }

  return (
    <div className="relative flex min-h-svh w-full items-center justify-center bg-zinc-50 p-6 md:p-10">
      <PageReveal className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 text-xl font-semibold tracking-tight text-foreground"
          >
            <img src="/logo.svg" alt="" className="size-7 rounded-[7px]" />
            xEngine
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            登录后继续把风险变成链上保障
          </p>
        </div>
        {callbackError ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700"
          >
            {callbackError}
          </p>
        ) : null}
        <LoginForm redirectPath={redirectPath} />
      </PageReveal>
    </div>
  )
}
