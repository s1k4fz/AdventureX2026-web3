import { useEffect, useState } from 'react'

import {
  applyAppearancePreference,
  type AppearancePreference,
  persistAppearancePreference,
  readAppearancePreference,
} from '@/features/home/appearancePreference'

export function useAppearancePreference() {
  const [appearance, setAppearanceState] = useState<AppearancePreference>(() =>
    readAppearancePreference()
  )

  useEffect(() => {
    persistAppearancePreference(appearance)

    if (appearance !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyAppearancePreference('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [appearance])

  return {
    appearance,
    setAppearance: setAppearanceState,
  }
}
