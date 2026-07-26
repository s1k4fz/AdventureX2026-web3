import { CandlestickChart } from 'lucide-react'

import { Switch } from '@/components/ui/switch'
import {
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '@/features/home/HomeSettingsPrimitives'
import { PANDA_MODULE_CATALOG } from '@/features/policy/pandaModulesPreference'
import { usePandaModulesPreference } from '@/features/policy/usePandaModulesPreference'
import { usePandaStatusQuery } from '@/features/policy/policyApi'
import { cn } from '@/lib/utils'

export function HomeSettingsDataSourcesPage() {
  const statusQuery = usePandaStatusQuery()
  const status = statusQuery.data
  const { modules, toggleModule } = usePandaModulesPreference()
  const enabledSet = new Set(modules)

  return (
    <>
      <SettingsPageHeader
        title="数据源"
        description="控制看板展示的金融数据集。Agent 采集仍以服务端配置为准。"
      />

      <div className="space-y-5">
        <SettingsSection
          title="PandaAI 量数金融"
          description="行情、期货与精选宏观指标"
        >
          <SettingsRow
            label="服务状态"
            hint={
              statusQuery.isPending
                ? '正在探测…'
                : status?.enabled
                  ? '已启用，可拉取快照'
                  : status?.configured
                    ? '已配置但未开启（PANDAAI_ENABLED）'
                    : '未配置账号'
            }
          >
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium',
                status?.enabled
                  ? 'border-[color-mix(in_srgb,var(--units-green)_35%,transparent)] text-[var(--units-green)]'
                  : 'border-border text-muted-foreground'
              )}
            >
              <CandlestickChart className="size-3.5" />
              {status?.enabled ? '已启用' : '未启用'}
            </span>
          </SettingsRow>
          {status?.modules && status.modules.length > 0 ? (
            <SettingsRow
              label="服务端默认模块"
              hint={status.modules.join(' · ')}
            >
              <span className="text-[12px] text-muted-foreground">env</span>
            </SettingsRow>
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="看板数据集"
          description="开关保存在本机，影响「量数金融」面板拉取内容。"
        >
          {PANDA_MODULE_CATALOG.map((mod) => {
            const on = enabledSet.has(mod.id)
            return (
              <SettingsRow
                key={mod.id}
                label={mod.label}
                hint={
                  mod.optional
                    ? `${mod.description} · 可选`
                    : mod.description
                }
              >
                <Switch
                  size="sm"
                  checked={on}
                  onCheckedChange={(checked) =>
                    toggleModule(mod.id, Boolean(checked))
                  }
                  aria-label={`切换 ${mod.label}`}
                />
              </SettingsRow>
            )
          })}
        </SettingsSection>
      </div>
    </>
  )
}
