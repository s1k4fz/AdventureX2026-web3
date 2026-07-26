export type OracleStatusErrorKind =
  | 'legacy'
  | 'chain_unavailable'
  | 'unavailable'
  | 'unknown'

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return undefined
  }
  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

function getErrorDetail(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return undefined
  }
  const response = (error as { response?: { data?: { detail?: unknown } } })
    .response
  return response?.data?.detail
}

/** Classify oracle-status API failures for UI branching. */
export function getOracleStatusErrorKind(error: unknown): OracleStatusErrorKind {
  const status = getErrorStatus(error)
  if (status == null) return 'unknown'
  const detail = getErrorDetail(error)
  if (status === 503 || detail === 'oracle_chain_unavailable') {
    return 'chain_unavailable'
  }
  if (status === 404) {
    return 'unavailable'
  }
  return 'unknown'
}
