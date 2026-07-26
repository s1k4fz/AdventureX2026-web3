/**
 * Offline smoke checks for oracle-status error classification.
 * Run: npm run test:oracle-status
 */
import { getOracleStatusErrorKind } from './oracleStatusUtils'

function httpError(status: number, detail?: string) {
  return {
    response: {
      status,
      data: detail != null ? { detail } : {},
    },
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  getOracleStatusErrorKind(httpError(503, 'oracle_chain_unavailable')) ===
    'chain_unavailable',
  '503 should be chain_unavailable'
)
assert(
  getOracleStatusErrorKind(httpError(404, 'oracle_status_unavailable')) ===
    'unavailable',
  '404 unavailable'
)
assert(
  getOracleStatusErrorKind(httpError(404, 'policy_not_found')) === 'unavailable',
  '404 not found'
)
assert(getOracleStatusErrorKind(httpError(500)) === 'unknown', '500 unknown')
assert(getOracleStatusErrorKind(new Error('boom')) === 'unknown', 'generic')

console.log('oracleStatusUtils.smoke: ok')
