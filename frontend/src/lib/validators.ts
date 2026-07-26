/** 输入清洗与校验工具：创建表单 / 调整面板共用。 */

export const NEED_TEXT_MAX = 2000
/** 字数接近上限时的提醒阈值。 */
export const NEED_TEXT_WARN = 1800

/**
 * 剔除控制字符（保留换行），压缩连续空行；用于提交前清洗需求文本。
 * emoji / 中英混排不做限制，由后端 LLM 处理。
 */
export function sanitizeNeedText(raw: string): string {
  return raw
    .replace(/[\p{Cc}]/gu, (char) => (char === '\n' ? '\n' : ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 输入期清洗：只去控制字符并截断，不 trim（避免打断正常输入）。 */
export function clampNeedTextInput(raw: string): string {
  return raw
    .replace(/[\p{Cc}]/gu, (char) => (char === '\n' ? '\n' : ''))
    .slice(0, NEED_TEXT_MAX)
}

/** 保费金额格式：正数，最多两位小数。 */
export const PREMIUM_PATTERN = /^\d+(\.\d{0,2})?$/

export function isValidPremiumInput(value: string): boolean {
  return PREMIUM_PATTERN.test(value.trim())
}
