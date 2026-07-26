/**
 * 工作台创建表单的结构化偏好 → 自然语言 goalText 拼装。
 * 后端问卷生成 LLM 消费的仍是纯文本 need_text，API 契约不变。
 */

export interface PolicyCreatePreferences {
  horizon: string | null
  budget: string | null
  risk: string | null
}

export const EMPTY_PREFERENCES: PolicyCreatePreferences = {
  horizon: null,
  budget: null,
  risk: null,
}

// 选项口径与 PolicyJourneyArtifact 的 BASIC_QUESTIONNAIRE 保持一致。
export const HORIZON_OPTIONS = [
  '1 个月',
  '3 个月',
  '6 个月',
  '12 个月',
] as const

export const BUDGET_OPTIONS = ['尽量低', '中等', '可为更高赔付加码'] as const

export const RISK_OPTIONS = ['保守', '平衡', '进取'] as const

/** 拼装偏好补充句；三项均未选时返回空串。 */
export function buildPreferenceText(
  preferences: PolicyCreatePreferences
): string {
  const parts: string[] = []
  if (preferences.horizon) parts.push(`保障期限 ${preferences.horizon}`)
  if (preferences.budget) parts.push(`保费预算${preferences.budget}`)
  if (preferences.risk) parts.push(`风险偏好${preferences.risk}`)
  return parts.length > 0 ? `补充偏好：${parts.join('；')}` : ''
}

export function buildGoalText(
  needText: string,
  preferences: PolicyCreatePreferences
): string {
  const trimmed = needText.trim()
  const preferenceText = buildPreferenceText(preferences)
  return preferenceText ? `${trimmed}\n\n${preferenceText}` : trimmed
}

export interface PolicyTemplate {
  title: string
  needText: string
  preferences: PolicyCreatePreferences
}

/** 常见场景模板：点击预填需求描述与快捷字段。 */
export const POLICY_TEMPLATES: readonly PolicyTemplate[] = [
  {
    title: '利率路径对冲',
    needText: '担心美联储年内降息次数不及预期，想对冲利率路径风险',
    preferences: { horizon: '6 个月', budget: '中等', risk: '平衡' },
  },
  {
    title: '加密回撤保护',
    needText: '想对冲 ETH 短期内大幅回调的风险',
    preferences: { horizon: '1 个月', budget: '中等', risk: '进取' },
  },
  {
    title: '能源地缘风险',
    needText: '担心地缘冲突升级影响能源价格，希望用预测市场做保护',
    preferences: { horizon: '3 个月', budget: '尽量低', risk: '保守' },
  },
  {
    title: '大选宏观波动',
    needText: '想对冲大选结果不确定带来的宏观波动',
    preferences: { horizon: '12 个月', budget: '中等', risk: '平衡' },
  },
] as const
