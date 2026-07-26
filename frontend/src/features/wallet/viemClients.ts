import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  isAddress,
  type PublicClient,
  type WalletClient,
} from 'viem'

import { env } from '@/lib/env'

// ---------------------------------------------------------------------------
// Injective EVM Testnet chain definition (chainId 1439)
// ---------------------------------------------------------------------------

export const injectiveTestnet = defineChain({
  id: 1439,
  name: 'Injective Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://testnet.evm.archival.chain.virtual.json-rpc.injective.network/',
        'https://k8s.testnet.json-rpc.injective.network/',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Injective Blockscout',
      url: 'https://testnet.blockscout.injective.network/',
    },
  },
})

// ---------------------------------------------------------------------------
// Contract addresses (Injective EVM Testnet)
// ---------------------------------------------------------------------------

export const POLICY_VAULT_ADDRESS =
  '0xD917958F636bc311Bfe7Da7A2468BDc70D3fb5f1' as const
export const MOCK_USDC_ADDRESS =
  '0xf12e9f2376752520859b60fc37ddb5764212DE2D' as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function readOptionalContractAddress(
  name: string,
  value: string
): { address: `0x${string}` | null; error: string | null } {
  if (!value) return { address: null, error: null }
  if (!isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    return {
      address: null,
      error: `${name} 必须是非零 EVM 合约地址`,
    }
  }
  return { address: getAddress(value), error: null }
}

/**
 * Deployment-supplied PolicyNFT address. Null is a supported state: metadata
 * remains visible, while the mint control explains that deployment is pending.
 */
const policyNftConfig = readOptionalContractAddress(
  'VITE_POLICY_NFT_ADDRESS',
  env.policyNftAddress
)

export const POLICY_NFT_ADDRESS = policyNftConfig.address
export const POLICY_NFT_CONFIG_ERROR = policyNftConfig.error

export const EXPLORER_BASE =
  injectiveTestnet.blockExplorers.default.url.replace(/\/+$/, '')

// ---------------------------------------------------------------------------
// Legacy tx constants (Injective testnet requires legacy tx, gasPrice 160e6)
// ---------------------------------------------------------------------------

export const LEGACY_TX_OVERRIDES = {
  type: 'legacy' as const,
  gasPrice: 160_000_000n, // 160e6 wei
  chain: injectiveTestnet,
}

// ---------------------------------------------------------------------------
// Public client (read-only, from RPC — no wallet needed)
// ---------------------------------------------------------------------------

let _publicClient: PublicClient | null = null

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: injectiveTestnet,
      transport: http(),
    })
  }
  return _publicClient
}

// ---------------------------------------------------------------------------
// Wallet client (write, from window.ethereum — requires connected wallet)
// ---------------------------------------------------------------------------

export function getWalletClient(): WalletClient | null {
  if (typeof window === 'undefined' || !window.ethereum) {
    return null
  }
  return createWalletClient({
    chain: injectiveTestnet,
    transport: custom(window.ethereum as Parameters<typeof custom>[0]),
  })
}
