import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { type AppearancePreference } from '@/features/home/appearancePreference'
import { useAppearancePreference } from '@/features/home/useAppearancePreference'
import {
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from '@/features/home/HomeSettingsPrimitives'

const appearanceOptions: {
  value: AppearancePreference
  label: string
  icon: typeof Sun
}[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

export function HomeSettingsGeneralPage() {
  const { appearance, setAppearance } = useAppearancePreference()
  const [language, setLanguage] = useState('zh')

  return (
    <>
      <SettingsPageHeader
        title="通用"
        description="控制界面语言与外观，偏好保存在本机。"
      />

      <div className="space-y-5">
        <SettingsSection title="语言">
          <SettingsRow label="界面语言" hint="影响设置与主要文案">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger
                size="sm"
                className="h-8 w-[108px] rounded-full border border-[var(--units-stroke-color)] bg-background shadow-none"
              >
                <SelectValue placeholder="选择语言" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">汉语</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection
          title="外观"
          description="奶油纸浅色是默认体验；也可切换深色或跟随系统。"
        >
          <div className="grid grid-cols-3 gap-2 p-2.5">
            {appearanceOptions.map((option) => {
              const Icon = option.icon
              const active = appearance === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAppearance(option.value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors',
                    active
                      ? 'border-[var(--units-stroke-color)] bg-[color-mix(in_srgb,var(--units-orange)_12%,transparent)] text-foreground'
                      : 'border-transparent bg-transparent text-muted-foreground hover:border-[var(--units-stroke-color)] hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                  <span className="text-[12px] font-semibold leading-4">
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </SettingsSection>
      </div>
    </>
  )
}
