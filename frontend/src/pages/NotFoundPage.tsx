import { Link } from 'react-router-dom'

import { PageReveal } from '@/components/PageReveal'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'

export function NotFoundPage() {
  const { status } = useAuth()
  const homeTo = status === 'authed' ? '/home' : '/'

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
      <PageReveal className="units-app-panel w-full max-w-md p-8 text-center">
        <p className="units-text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          404
        </p>
        <h1 className="units-text-title mt-2">页面不存在</h1>
        <p className="units-text-body-sm mt-2 text-muted-foreground">
          链接可能已失效，或你没有访问该地址的权限。
        </p>
        <Button asChild className="units-cta mt-6 rounded-full shadow-none">
          <Link to={homeTo}>{status === 'authed' ? '返回看板' : '返回首页'}</Link>
        </Button>
      </PageReveal>
    </main>
  )
}
