/**
 * PolicyVault ABI — extracted from contracts/src/PolicyVault.sol
 * Only the functions/events needed by the frontend funding flow.
 */
export const policyVaultAbi = [
  // ── openPolicy ──────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'openPolicy',
    inputs: [
      { name: 'policyId', type: 'bytes32', internalType: 'bytes32' },
      {
        name: 'positions',
        type: 'tuple[]',
        internalType: 'struct PolicyVault.PositionInput[]',
        components: [
          { name: 'marketRef', type: 'bytes32', internalType: 'bytes32' },
          { name: 'sideYes', type: 'bool', internalType: 'bool' },
          { name: 'entryPriceBps', type: 'uint16', internalType: 'uint16' },
          { name: 'weightBps', type: 'uint16', internalType: 'uint16' },
        ],
      },
      { name: 'premium', type: 'uint256', internalType: 'uint256' },
      { name: 'coverageEnd', type: 'uint64', internalType: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ── policies mapping getter ─────────────────────────────────────────────────
  {
    type: 'function',
    name: 'policies',
    inputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'premium', type: 'uint256', internalType: 'uint256' },
      { name: 'maxPayout', type: 'uint256', internalType: 'uint256' },
      { name: 'coverageEnd', type: 'uint64', internalType: 'uint64' },
      { name: 'settled', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },

  // ── freeLiquidity ───────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'freeLiquidity',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // ── reserved ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'reserved',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // ── feeBps ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'feeBps',
    inputs: [],
    outputs: [{ name: '', type: 'uint16', internalType: 'uint16' }],
    stateMutability: 'view',
  },

  // ── usdc (immutable) ────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'usdc',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },

  // ── PolicyOpened event ──────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'PolicyOpened',
    inputs: [
      { name: 'policyId', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'user', type: 'address', indexed: true, internalType: 'address' },
      { name: 'premium', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'fee', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'maxPayout', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'coverageEnd', type: 'uint64', indexed: false, internalType: 'uint64' },
    ],
    anonymous: false,
  },
] as const
