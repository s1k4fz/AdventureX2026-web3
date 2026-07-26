/**
 * Offline smoke checks for health-score marks loading / partial / empty handling.
 * Run: npm run test:health-score
 */
import { computePolicyHealthScore } from './PolicyHealthScore'
import type { PolicyDetail, PolicyMarks } from '../../policy/policyApi'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const basePolicy = {
  id: 'p1',
  status: 'active',
  premium: 100,
  coverageEnd: null,
  openedAt: null,
  createdAt: new Date().toISOString(),
  selectedPortfolioId: 'pf1',
  portfolios: [
    {
      id: 'pf1',
      positions: [],
      expectedPayout: 200,
    },
  ],
} as unknown as PolicyDetail

const fullMarks: PolicyMarks = {
  policyId: 'p1',
  updatedAt: new Date().toISOString(),
  asOf: new Date().toISOString(),
  quoteSource: 'polymarket_gamma',
  positions: [],
  totalMarkValue: 95,
  coverage: { quoted: 2, total: 2, status: 'full' },
  stale: false,
  sharesRecomputed: false,
}

const emptyMarks: PolicyMarks = {
  policyId: 'p1',
  updatedAt: new Date().toISOString(),
  positions: [],
  totalMarkValue: null,
  coverage: { quoted: 0, total: 2, status: 'none' },
  unavailableReason: 'gamma_unreachable:ConnectError',
  stale: true,
  sharesRecomputed: false,
}

const partialMarks: PolicyMarks = {
  policyId: 'p1',
  updatedAt: new Date().toISOString(),
  positions: [],
  totalMarkValue: 40,
  coverage: { quoted: 1, total: 2, status: 'partial' },
  stale: false,
  sharesRecomputed: true,
}

const loading = computePolicyHealthScore({
  policy: basePolicy,
  marks: null,
  marksLoading: true,
  marksError: false,
})
assert(
  !loading.keyRisks.some((r) => r.id === 'marks-missing'),
  'loading must not add marks-missing'
)

const errored = computePolicyHealthScore({
  policy: basePolicy,
  marks: null,
  marksLoading: false,
  marksError: true,
})
assert(
  errored.keyRisks.some((r) => r.id === 'marks-error'),
  'error should surface marks-error'
)
assert(
  !errored.keyRisks.some((r) => r.id === 'marks-missing'),
  'error should not also add marks-missing'
)

const empty = computePolicyHealthScore({
  policy: basePolicy,
  marks: emptyMarks,
  marksLoading: false,
})
assert(
  empty.keyRisks.some((r) => r.id === 'marks-missing'),
  'empty quotes should add marks-missing'
)

const partial = computePolicyHealthScore({
  policy: basePolicy,
  marks: partialMarks,
  marksLoading: false,
})
assert(
  partial.keyRisks.some((r) => r.id === 'marks-partial'),
  'partial coverage should add marks-partial'
)

const ok = computePolicyHealthScore({
  policy: basePolicy,
  marks: fullMarks,
  marksLoading: false,
})
assert(
  !ok.keyRisks.some((r) =>
    ['marks-missing', 'marks-error', 'marks-partial'].includes(r.id)
  ),
  'full coverage near premium should not add marks risks'
)

console.log('PolicyHealthScore.smoke: ok')
