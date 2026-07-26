import { create } from 'zustand'

// EIP-1193 minimal typing for window.ethereum (no external types package)
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

// Injective Testnet chain config
const INJECTIVE_TESTNET_CHAIN_ID = '0x59f' // 1439
const INJECTIVE_TESTNET_PARAMS = {
  chainId: INJECTIVE_TESTNET_CHAIN_ID,
  chainName: 'Injective Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  // The validator RPC occasionally returns null for confirmed EVM receipts,
  // which makes MetaMask falsely label successful transactions as failed.
  // Prefer Injective's archival EVM gateway for wallet receipt tracking.
  rpcUrls: [
    'https://testnet.evm.archival.chain.virtual.json-rpc.injective.network/',
    'https://k8s.testnet.json-rpc.injective.network/',
  ],
  blockExplorerUrls: ['https://testnet.blockscout.injective.network/'],
}

async function addOrUpdateInjectiveTestnetRpc(provider: EIP1193Provider) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [INJECTIVE_TESTNET_PARAMS],
  })
}

export type WalletStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'wrong-network'

export interface WalletState {
  address: string | null
  chainId: number | null
  status: WalletStatus
  initialize: () => Promise<void>
  connect: () => Promise<void>
  switchToInjectiveTestnet: () => Promise<void>
  disconnect: () => void
}

let walletListenersBound = false

export const useWalletStore = create<WalletState>((set, get) => ({
  address: null,
  chainId: null,
  status: 'disconnected',

  initialize: async () => {
    const provider = window.ethereum
    if (!provider) return

    const syncWallet = async () => {
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
        const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
        const address = accounts[0] ?? null
        const chainId = parseInt(chainIdHex, 16)
        set({
          address,
          chainId,
          status: !address
            ? 'disconnected'
            : chainId === parseInt(INJECTIVE_TESTNET_CHAIN_ID, 16)
              ? 'connected'
              : 'wrong-network',
        })
      } catch (error) {
        console.error('Wallet state refresh failed', error)
      }
    }

    if (!walletListenersBound) {
      provider.on?.('accountsChanged', () => void syncWallet())
      provider.on?.('chainChanged', () => void syncWallet())
      walletListenersBound = true
    }
    await syncWallet()
  },

  connect: async () => {
    const provider = window.ethereum
    if (!provider) {
      console.warn('No injected wallet found (window.ethereum)')
      return
    }

    set({ status: 'connecting' })
    try {
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const chainIdHex = (await provider.request({
        method: 'eth_chainId',
      })) as string
      const chainId = parseInt(chainIdHex, 16)
      const address = accounts[0] ?? null

      if (chainId !== parseInt(INJECTIVE_TESTNET_CHAIN_ID, 16)) {
        set({ address, chainId, status: 'wrong-network' })
      } else {
        // For an existing chain MetaMask asks the user before adding this RPC
        // as the default. Rejection must not prevent the wallet from connecting.
        try {
          await addOrUpdateInjectiveTestnetRpc(provider)
        } catch (rpcError) {
          console.warn('Injective archival RPC update was not accepted', rpcError)
        }
        set({ address, chainId, status: 'connected' })
      }
    } catch (err) {
      console.error('Wallet connect failed', err)
      set({ status: 'disconnected' })
    }
  },

  switchToInjectiveTestnet: async () => {
    const provider = window.ethereum
    if (!provider) return

    try {
      try {
        await addOrUpdateInjectiveTestnetRpc(provider)
      } catch (rpcError) {
        console.warn('Injective archival RPC update was not accepted', rpcError)
      }
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: INJECTIVE_TESTNET_CHAIN_ID }],
      })
      set({
        chainId: parseInt(INJECTIVE_TESTNET_CHAIN_ID, 16),
        status: get().address ? 'connected' : 'disconnected',
      })
    } catch (switchError: unknown) {
      // Code 4902 = chain not added yet
      if (
        typeof switchError === 'object' &&
        switchError !== null &&
        'code' in switchError &&
        (switchError as { code: number }).code === 4902
      ) {
        try {
          await addOrUpdateInjectiveTestnetRpc(provider)
          set({
            chainId: parseInt(INJECTIVE_TESTNET_CHAIN_ID, 16),
            status: get().address ? 'connected' : 'disconnected',
          })
        } catch (addError) {
          console.error('Failed to add Injective Testnet', addError)
        }
      } else {
        console.error('Failed to switch chain', switchError)
      }
    }
  },

  disconnect: () => {
    set({ address: null, chainId: null, status: 'disconnected' })
  },
}))
