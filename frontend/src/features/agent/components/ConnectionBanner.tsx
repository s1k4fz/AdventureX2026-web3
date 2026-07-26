import { RefreshCw, WifiOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import type { AgentConnectionState } from '../types'

export type { AgentConnectionState }

/**
 * SSE 连接状态提示条：重连期间给出可见反馈（避免被误判为卡死），
 * 致命停止时提供刷新入口。`live` 时不渲染。
 */
export function ConnectionBanner({
  state,
}: {
  state: AgentConnectionState
}) {
  if (state === 'live') return null

  if (state === 'reconnecting') {
    return (
      <p
        role="status"
        className="flex shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--units-orange)_30%,transparent)] bg-[color-mix(in_srgb,var(--units-orange)_8%,transparent)] px-4 py-2 text-[12.5px] text-foreground"
      >
        <Spinner className="size-3 text-[var(--units-orange)]" />
        实时连接中断，正在重连…进度不会丢失
      </p>
    )
  }

  return (
    <p
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--units-red)_30%,transparent)] bg-[color-mix(in_srgb,var(--units-red)_8%,transparent)] px-4 py-2 text-[12.5px] text-foreground"
    >
      <WifiOff className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">实时连接已停止，页面内容可能不是最新</span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-7 shrink-0 gap-1 rounded-full border-[var(--units-stroke-color)] px-2.5 text-[12px]"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="size-3" />
        刷新
      </Button>
    </p>
  )
}
