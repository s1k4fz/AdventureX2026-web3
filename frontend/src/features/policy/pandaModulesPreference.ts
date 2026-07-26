/** Local preference for which PandaAI modules the UI panel fetches. */

export type PandaModuleId =
  | 'index'
  | 'index_ext'
  | 'futures'
  | 'futures_ext'
  | 'macro'
  | 'macro_pi'
  | 'macro_energy'
  | 'fx'
  | 'calendar'

export const PANDA_MODULES_STORAGE_KEY = 'xengine.pandaai.modules'

export const PANDA_MODULE_CATALOG: Array<{
  id: PandaModuleId
  label: string
  description: string
  optional?: boolean
}> = [
  {
    id: 'index',
    label: 'A股核心指数',
    description: '沪深300 / 上证综指 / 创业板指',
  },
  {
    id: 'index_ext',
    label: 'A股扩展指数',
    description: '上证50 / 深证成指 / 科创50',
    optional: true,
  },
  {
    id: 'futures',
    label: '核心期货',
    description: '原油 / 黄金 / 铜',
  },
  {
    id: 'futures_ext',
    label: '扩展期货',
    description: '白银 / 铁矿 / 螺纹 / 豆粕',
    optional: true,
  },
  {
    id: 'macro',
    label: '核心宏观',
    description: 'LPR / 美元兑人民币 / 10Y国债 / PMI',
  },
  {
    id: 'macro_pi',
    label: '价格指数',
    description: 'CPI / 食品CPI / PPI',
    optional: true,
  },
  {
    id: 'macro_energy',
    label: '能源宏观',
    description: '布伦特原油期货',
    optional: true,
  },
  {
    id: 'fx',
    label: '主要外汇',
    description: '欧元 / 日元 / 英镑兑人民币',
    optional: true,
  },
  {
    id: 'calendar',
    label: '交易日历',
    description: 'A股最新交易日',
  },
]

export const DEFAULT_PANDA_MODULES: PandaModuleId[] = [
  'index',
  'futures',
  'macro',
  'calendar',
]

const KNOWN = new Set(PANDA_MODULE_CATALOG.map((m) => m.id))

export function readPandaModulesPreference(): PandaModuleId[] {
  try {
    const raw = localStorage.getItem(PANDA_MODULES_STORAGE_KEY)
    if (!raw) return [...DEFAULT_PANDA_MODULES]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_PANDA_MODULES]
    const out: PandaModuleId[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && KNOWN.has(item as PandaModuleId)) {
        const id = item as PandaModuleId
        if (!out.includes(id)) out.push(id)
      }
    }
    return out.length > 0 ? out : [...DEFAULT_PANDA_MODULES]
  } catch {
    return [...DEFAULT_PANDA_MODULES]
  }
}

export function persistPandaModulesPreference(modules: PandaModuleId[]) {
  try {
    localStorage.setItem(PANDA_MODULES_STORAGE_KEY, JSON.stringify(modules))
  } catch {
    // ignore
  }
}

export function modulesQueryParam(modules: PandaModuleId[]): string {
  return modules.join(',')
}
