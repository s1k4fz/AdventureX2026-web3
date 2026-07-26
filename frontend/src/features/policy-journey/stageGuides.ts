import type { JourneyStage } from './types'

export interface StageGuide {
  /** 这一步系统在做什么。 */
  what: string
  /** 需要用户做什么；无需操作时给出可选动作。 */
  you: string
  /** 预计耗时提示。 */
  estimate?: string
}

/**
 * 每个旅程阶段的统一指引文案：StageGuideBar 渲染，替代各阶段各写各的
 * 引导语。`you` 在 waiting_user 时高亮为「待你操作」。
 */
export const STAGE_GUIDES: Record<JourneyStage, StageGuide> = {
  needs: {
    what: '系统正根据你的风险描述生成确认问卷',
    you: '回答问卷（至少一题）并提交',
    estimate: '约 1 分钟',
  },
  risk_profile: {
    what: '正在把你的回答整理成风险画像与检索关键词',
    you: '无需操作，可随时补充需求',
    estimate: '数秒',
  },
  market_research: {
    what: '多名调查员并行检索预测市场与宏观信号',
    you: '无需操作，可随时补充需求',
    estimate: '约 1–2 分钟',
  },
  coverage_plan: {
    what: '基于采集到的情报生成三档保障方案',
    you: '比较并选择一个保障档位',
    estimate: '约 1 分钟',
  },
  on_chain_active: {
    what: '锁定档位后在链上完成授权与开保',
    you: '连接钱包、设置保费并确认出资',
    estimate: '约 1–2 分钟',
  },
}
