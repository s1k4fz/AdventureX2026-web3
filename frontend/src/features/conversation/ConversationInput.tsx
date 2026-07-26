import {
  AgentInput,
  type AgentInputPayload,
} from '@/components/AgentInput'

// 受控输入：value 由页面持有，便于首字前失败时把草稿还原到输入框。
export function ConversationInput({
  className,
  value,
  onValueChange,
  isStreaming,
  onSend,
  onStop,
  variant = 'default',
  modeLabel = '风险 Agent',
  placeholder = '描述你想对冲的风险，例如：担心美联储年内降息次数不及预期…',
}: {
  className?: string
  value: string
  onValueChange: (value: string) => void
  isStreaming: boolean
  onSend: (payload: AgentInputPayload) => void
  onStop: () => void
  variant?: 'default' | 'home'
  /** 当前唯一模式的展示标签（不可切换） */
  modeLabel?: string
  placeholder?: string
}) {
  return (
    <AgentInput
      className={className}
      value={value}
      onValueChange={onValueChange}
      isBusy={isStreaming}
      onStop={onStop}
      onSend={onSend}
      variant={variant}
      modeLabel={modeLabel}
      placeholder={placeholder}
    />
  )
}
