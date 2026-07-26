import { cn } from '@/lib/utils'

export type PolicyDetailTabId =
  | 'overview'
  | 'research'
  | 'portfolio'
  | 'ops'
  | 'nft'

/** Legacy deep-link tab ids mapped onto the consolidated set. */
const LEGACY_TAB_MAP: Record<string, PolicyDetailTabId> = {
  health: 'overview',
  overview: 'overview',
  research: 'research',
  observation: 'research',
  portfolio: 'portfolio',
  chain: 'ops',
  monitoring: 'ops',
  nft: 'nft',
  ops: 'ops',
}

export function resolvePolicyDetailTab(
  raw: string | null | undefined
): PolicyDetailTabId | null {
  if (!raw) return null
  return LEGACY_TAB_MAP[raw] ?? null
}

export function PolicyDetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: PolicyDetailTabId; label: string }[]
  active: PolicyDetailTabId
  onChange: (id: PolicyDetailTabId) => void
}) {
  return (
    <nav className="shrink-0 border-b border-border px-5" aria-label="保单详情分区">
      <div className="flex gap-0.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-3 py-2.5 text-[13px] font-medium transition-colors',
              active === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {active === tab.id && (
              <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--units-orange)]" />
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
