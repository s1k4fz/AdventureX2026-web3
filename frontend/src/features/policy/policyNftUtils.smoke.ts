import {
  isCanonicalPolicyNFTTokenId,
  onChainPolicyIdToTokenId,
  policyUuidToTokenId,
} from './policyNftUtils'

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const uuidHex = '123e4567e89b12d3a456426614174000'
assertEqual(
  policyUuidToTokenId('123e4567-e89b-12d3-a456-426614174000'),
  BigInt(`0x${uuidHex}`).toString(10),
  'UUID token ID'
)
assertEqual(
  policyUuidToTokenId('00000000-0000-0000-0000-000000000000'),
  '0',
  'zero UUID token ID'
)
assertEqual(
  policyUuidToTokenId('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ((1n << 128n) - 1n).toString(10),
  'maximum UUID token ID'
)
assertEqual(policyUuidToTokenId('not-a-uuid'), null, 'invalid UUID is rejected')
assertEqual(
  onChainPolicyIdToTokenId(`0x${'0'.repeat(32)}${uuidHex}`),
  BigInt(`0x${uuidHex}`).toString(10),
  'left-padded UUID token ID'
)

assertEqual(
  onChainPolicyIdToTokenId(`0x${'0'.repeat(32)}${'f'.repeat(32)}`),
  ((1n << 128n) - 1n).toString(10),
  'maximum UUID token ID'
)
assertEqual(
  onChainPolicyIdToTokenId(`0x${'0'.repeat(64)}`),
  '0',
  'zero token ID is preserved'
)
assertEqual(
  onChainPolicyIdToTokenId(`0x1${'0'.repeat(63)}`),
  null,
  'non-UUID bytes32 is rejected'
)
assertEqual(onChainPolicyIdToTokenId('not-bytes32'), null, 'invalid hex is rejected')

assertEqual(isCanonicalPolicyNFTTokenId('0'), true, 'zero token ID is valid')
assertEqual(
  isCanonicalPolicyNFTTokenId(((1n << 128n) - 1n).toString()),
  true,
  'maximum UUID token ID is valid'
)
assertEqual(isCanonicalPolicyNFTTokenId('01'), false, 'leading zero is rejected')
assertEqual(
  isCanonicalPolicyNFTTokenId((1n << 128n).toString()),
  false,
  'out-of-range token ID is rejected'
)

console.log('policyNftUtils.smoke: all assertions passed')
