import { useCallback, useState, useSyncExternalStore } from 'react'

import {
  persistPandaModulesPreference,
  readPandaModulesPreference,
  type PandaModuleId,
  PANDA_MODULES_STORAGE_KEY,
} from './pandaModulesPreference'

function subscribe(onStoreChange: () => void) {
  const handler = (event: StorageEvent) => {
    if (event.key === PANDA_MODULES_STORAGE_KEY || event.key === null) {
      onStoreChange()
    }
  }
  window.addEventListener('storage', handler)
  window.addEventListener('xengine:panda-modules', onStoreChange)
  return () => {
    window.removeEventListener('storage', handler)
    window.removeEventListener('xengine:panda-modules', onStoreChange)
  }
}

function getSnapshot(): string {
  return JSON.stringify(readPandaModulesPreference())
}

function getServerSnapshot(): string {
  return JSON.stringify([])
}

export function usePandaModulesPreference() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const modules = JSON.parse(raw) as PandaModuleId[]
  const [, bump] = useState(0)

  const setModules = useCallback((next: PandaModuleId[]) => {
    persistPandaModulesPreference(next)
    window.dispatchEvent(new Event('xengine:panda-modules'))
    bump((n) => n + 1)
  }, [])

  const toggleModule = useCallback(
    (id: PandaModuleId, enabled: boolean) => {
      const current = readPandaModulesPreference()
      const next = enabled
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((m) => m !== id)
      setModules(next)
    },
    [setModules]
  )

  return { modules, setModules, toggleModule }
}
