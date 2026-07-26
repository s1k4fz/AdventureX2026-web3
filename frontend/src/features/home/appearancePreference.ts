export type AppearancePreference = 'system' | 'light' | 'dark'

export const APPEARANCE_STORAGE_KEY = 'xengine.appearance'

export function readAppearancePreference(): AppearancePreference {
  try {
    const value = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') {
      return value
    }
  } catch {
    // ignore storage access errors
  }

  return 'light'
}

export function resolveAppearance(preference: AppearancePreference): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') {
    return preference
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function applyAppearancePreference(preference: AppearancePreference) {
  const resolved = resolveAppearance(preference)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

export function persistAppearancePreference(preference: AppearancePreference) {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, preference)
  } catch {
    // ignore storage access errors
  }

  applyAppearancePreference(preference)
}
