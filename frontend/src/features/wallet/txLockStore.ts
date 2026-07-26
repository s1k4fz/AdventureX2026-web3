import { create } from 'zustand'

/**
 * Global in-flight transaction lock.
 * While a wallet transaction is in progress (approve/openPolicy/mint),
 * ALL tx-producing buttons must be disabled to prevent double-broadcast.
 */
export interface TxLockState {
  /** Whether a transaction is currently in flight */
  isTxInFlight: boolean
  /** Human-readable label for the current in-flight operation */
  txLabel: string | null
  /** Acquire the lock. Returns false if already held. */
  acquire: (label: string) => boolean
  /** Release the lock. */
  release: () => void
}

export const useTxLockStore = create<TxLockState>((set, get) => ({
  isTxInFlight: false,
  txLabel: null,

  acquire: (label: string) => {
    if (get().isTxInFlight) return false
    set({ isTxInFlight: true, txLabel: label })
    return true
  },

  release: () => {
    set({ isTxInFlight: false, txLabel: null })
  },
}))
