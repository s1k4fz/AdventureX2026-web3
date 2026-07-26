const ON_CHAIN_POLICY_ID_RE = /^0x[0-9a-fA-F]{64}$/
const UINT128_MAX = (1n << 128n) - 1n
const CANONICAL_TOKEN_ID_RE = /^(0|[1-9][0-9]{0,38})$/
const POLICY_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isCanonicalPolicyNFTTokenId(tokenId: string): boolean {
  if (!CANONICAL_TOKEN_ID_RE.test(tokenId)) return false
  try {
    return BigInt(tokenId) <= UINT128_MAX
  } catch {
    return false
  }
}

/**
 * PolicyVault IDs are UUID bytes left-padded to bytes32 by the backend. The
 * PolicyNFT contract casts that exact bytes32 value to uint256 for tokenId.
 */
export function onChainPolicyIdToTokenId(
  onChainPolicyId: string
): string | null {
  if (!ON_CHAIN_POLICY_ID_RE.test(onChainPolicyId)) return null
  try {
    const value = BigInt(onChainPolicyId)
    if (value > UINT128_MAX) return null
    return value.toString(10)
  } catch {
    return null
  }
}

/** Convert the database UUID into the same deterministic uint128 token ID. */
export function policyUuidToTokenId(policyId: string): string | null {
  if (!POLICY_UUID_RE.test(policyId)) return null
  try {
    return BigInt(`0x${policyId.replaceAll('-', '')}`).toString(10)
  } catch {
    return null
  }
}
