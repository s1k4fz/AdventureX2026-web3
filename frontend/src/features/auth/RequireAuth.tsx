import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { PixelArt } from '@/components/pixel'
import { useAuth } from '@/features/auth/useAuth'

export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div
        className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background"
        aria-busy="true"
        role="status"
        aria-label="正在验证会话"
      >
        <div className="relative flex flex-col items-center gap-3">
          <PixelArt
            pattern="spark"
            animate
            size="sm"
            label="xEngine 启动中"
            className="rounded-sm"
          />
          <p className="text-[12px] text-muted-foreground">验证会话…</p>
        </div>
      </div>
    )
  }

  if (status === 'unauthed') {
    // 未登录一律回落地页（含退出登录后的场景）；from 透传给落地页，
    // 落地页的登录入口再转交 LoginPage，登录成功仍可回到原页面。
    return <Navigate to="/" replace state={{ from: location }} />
  }

  return <Outlet />
}
