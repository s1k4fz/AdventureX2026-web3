import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAgentTaskByPolicy } from '@/features/agent/agentApi'
import {
  agentDebug,
  agentDebugWarn,
  summarizeAgentEvent,
} from '@/features/agent/agentDebug'
import { streamAgentEvents } from '@/features/agent/streamAgentEvents'
import type { AgentEvent } from '@/features/agent/types'
import { apiClient } from '@/lib/apiClient'
import { retryUnlessClientError, signOutOn401 } from '@/lib/apiUtils'
import type { MarketSearchProgress } from './streamPolicyCompose'

// ---------------------------------------------------------------------------
// Domain types (mirror the canonical wire contract)
// ---------------------------------------------------------------------------

export interface PositionOut {
  id: string
  marketRef: string
  question: string
  side: 'YES' | 'NO'
  entryPriceBps: number
  weight: number
  resolutionDate: string | null
  aiReason: string
  odds: number | null
  volume: number | null
  /** Optional market profile fields — graceful degrade when absent */
  spreadBps?: number | null
  liquidity?: number | null
  category?: string | null
  lowLiquidity?: boolean | null
}

export interface PortfolioMetrics {
  avgEntryProbability?: number | null
  marketDiversity?: number | null
  nearestResolutionDate?: string | null
  breakevenHitRate?: number | null
  impliedAnnualOdds?: number | null
  portfolioHitProbability?: number | null
}

export interface PortfolioScenarioLeg {
  marketRef: string
  question: string
  side: 'YES' | 'NO'
  hit: boolean
}

export interface PortfolioScenario {
  label: string
  hitCount?: number | null
  totalCount?: number | null
  payout: number
  netProfit: number
  probability?: number | null
  legs?: PortfolioScenarioLeg[] | null
}

export interface PortfolioOut {
  id: string
  tier: 'conservative' | 'balanced' | 'aggressive'
  title: string
  // Nullable to match the backend schema (schemas/policy.py PolicyPortfolioOut);
  // the M1 happy path always populates them, but the wire allows null.
  thesis: string | null
  premiumEstimate: number | null
  expectedPayout: number | null
  positions: PositionOut[]
  metrics?: PortfolioMetrics | null
  scenarios?: PortfolioScenario[] | null
}

export interface PolicySettlementOutcome {
  marketRef: string
  question: string
  side: 'YES' | 'NO'
  outcomeYes: boolean
  hit: boolean
}

// ---------------------------------------------------------------------------
// Oracle status types (M3 observability)
// ---------------------------------------------------------------------------

export interface OracleLegStatus {
  marketRef: string
  question: string
  side: string
  status: number // 0=None, 1=Asserted, 2=Disputed, 3=Resolved
  statusLabel: 'pending' | 'asserted' | 'disputed' | 'resolved'
  proposer: string | null
  assertedYes: boolean | null
  assertTime: number | null // unix timestamp
  liveness: number | null // seconds
  challengeDeadline: number | null // assert_time + liveness
  disputer: string | null
  finalYes: boolean | null
  hit: boolean | null
}

export interface PolicyOracleStatus {
  policyId: string
  onChainPolicyId: string
  oracleAddress: string
  livenessSeconds: number
  bondUsdc: number
  legs: OracleLegStatus[]
  allResolved: boolean
  progressPct: number // 0-100
  mode: 'live' | 'legacy'
  fetchedAt: string // ISO8601
}

export interface RiskFactorCategory {
  id: string
  label: string
  rationale?: string
}

export interface WorldSignal {
  id: string
  kind: 'sentiment' | 'risk' | 'macro' | 'prediction' | 'news' | 'health'
  label: string
  value: string
  detail?: string
  score?: number | null
  region?: string | null
  trend?: string | null
  source?: string
}

export interface WorldContext {
  fetchedAt: string
  freshness: 'fresh' | 'stale' | 'degraded' | 'unavailable'
  source: 'live' | 'health_only' | 'cache' | 'unavailable'
  summary: string
  signals: WorldSignal[]
  fearGreed: number | null
  fearGreedLabel: string | null
  topRisks: WorldSignal[]
  healthStatus: string | null
  error: string | null
}

export interface PolicyDetail {
  id: string
  title: string
  status: string
  searchStatus?: 'searching' | 'searched' | 'failed'
  questionnaireReady: boolean
  needText: string
  coverageEnd: string | null
  premium: number | null
  portfolios: PortfolioOut[]
  onChainPolicyId: string | null
  openTx: string | null
  openedAt: string | null
  settleTx: string | null
  payout: number | null
  selectedPortfolioId: string | null
  createdAt: string | null
  updatedAt: string | null
  settlementOutcomes: PolicySettlementOutcome[]
  factorCategories?: RiskFactorCategory[]
  nftTokenId: string | null
  nftMintTx: string | null
  nftMintedAt: string | null
  nftMetadataUri: string | null
}

export type ResearchSelection = 'selected' | 'pool'
export type ResearchSearchStatus = 'searching' | 'searched' | 'failed'

export interface ResearchPlatformCount {
  platform: string
  count: number
}

export interface ResearchCandidate {
  conditionId: string
  platform: string
  question: string
  url: string
  slug: string | null
  volume: number | null
  liquidity: number | null
  volume24hr: number | null
  spread: number | null
  yesPriceBps: number | null
  endDate: string | null
  category: string | null
  tags: string[]
  rank: number
  selection: ResearchSelection
}

export interface ResearchSource {
  kind: string
  status: string
  summary?: string
  itemCount?: number
  errorCode?: string | null
  errorMessage?: string | null
  citations?: Array<{
    title?: string
    url?: string
    snippet?: string
    kind?: string
  }>
}

export interface PolicyResearch {
  policyId: string
  searchStatus: ResearchSearchStatus
  policyStatus: string
  totalCount: number
  returnedCount: number
  researchedAt: string | null
  selectedConditionIds: string[]
  platforms: ResearchPlatformCount[]
  candidates: ResearchCandidate[]
  sources?: ResearchSource[]
  evidencePack?: Record<string, unknown> | null
}

export interface PolicyListItem {
  id: string
  title: string
  status: string
  updatedAt: string
  openTx: string | null
  openedAt: string | null
  coverageEnd: string | null
  premium: number | null
  expectedPayout: number | null
  selectedPortfolioTier: string | null
  hasNft: boolean
  nftTokenId: string | null
  nftMintedAt: string | null
}

export interface PolicyNFTAttribute {
  trait_type: string
  value: string | number
  display_type?: 'number' | 'date' | string
}

export interface PolicyNFTMetadata {
  name: string
  description: string
  image: string
  external_url: string
  attributes: PolicyNFTAttribute[]
}

export type MarksCoverageStatus = 'full' | 'partial' | 'none'
export type MarksSharesSource = 'on_chain' | 'recomputed'

export interface PolicyMarksCoverage {
  quoted: number
  total: number
  status: MarksCoverageStatus
}

export interface PolicyPositionMark {
  marketRef: string
  question?: string | null
  side: 'YES' | 'NO'
  currentPriceBps?: number | null
  entryPriceBps?: number | null
  weightBps?: number | null
  markValue?: number | null
  nullPriceReason?: string | null
  sharesSource?: MarksSharesSource | null
}

export interface PolicyMarks {
  policyId: string
  updatedAt: string
  /** Quote as-of time (Gamma fetch time; not settlement oracle). */
  asOf?: string | null
  quoteSource?: string
  positions: PolicyPositionMark[]
  totalMarkValue?: number | null
  fullHitPayout?: number | null
  premium?: number | null
  coverage?: PolicyMarksCoverage
  stale?: boolean
  unavailableReason?: string | null
  sharesRecomputed?: boolean
}

export interface QuestionnaireQuestion {
  id: string
  title: string
  options: string[]
}

export interface PolicyQuestionnaire {
  factorCategories?: RiskFactorCategory[]
  questions: QuestionnaireQuestion[]
}

export interface PolicyIntakeAnswer {
  questionId: string
  answer: string
}

export type QuestionnaireAnswers = Record<string, string | null>

// ---------------------------------------------------------------------------
// PolicyFundingPlan — returned by POST /select (backend contract)
// ---------------------------------------------------------------------------

export interface PolicyFundingPosition {
  marketRef: `0x${string}` // bytes32
  sideYes: boolean
  entryPriceBps: number
  weightBps: number
}

export interface PolicyFundingPlan {
  policyId: string
  onChainPolicyId: `0x${string}` // bytes32
  chainId: 1439
  vaultAddress: `0x${string}`
  usdcAddress: `0x${string}`
  feeBps: number
  premiumBaseUnits: string // 6-decimal integer string
  maxPayoutBaseUnits: string
  coverageEnd: number // unix seconds
  positions: PolicyFundingPosition[]
}

export type PolicyPlannerStage =
  | 'questionnaire'
  | 'searching'
  | 'proposed'
  | 'active'
  | 'failed'

// ---------------------------------------------------------------------------
// View mapping
// ---------------------------------------------------------------------------

export function mapPolicyStatusToStage(
  status: string,
  questionnaireReady: boolean
): PolicyPlannerStage {
  switch (status) {
    case 'intake':
      return 'questionnaire'
    case 'composing':
      return 'searching'
    case 'proposed':
      return 'proposed'
    case 'funded':
    case 'active':
    case 'settled':
      return 'active'
    case 'failed':
      return 'failed'
    default:
      // Forward-compat: unknown statuses treated as questionnaire if not ready
      return questionnaireReady ? 'searching' : 'questionnaire'
  }
}

export interface PolicyView {
  stage: PolicyPlannerStage
  title: string
  portfolios: PortfolioOut[]
  needText: string
  premium: number | null
  coverageEnd: string | null
}

export function mapPolicyToView(detail: PolicyDetail): PolicyView {
  return {
    stage: mapPolicyStatusToStage(detail.status, detail.questionnaireReady),
    title: detail.title,
    portfolios: detail.portfolios,
    needText: detail.needText,
    premium: detail.premium,
    coverageEnd: detail.coverageEnd,
  }
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const QUESTIONNAIRE_POLL_MS = 1500

export const policyPlannerQueryRootKey = ['policy-planner'] as const

export function policyQueryKey(policyId: string) {
  return [...policyPlannerQueryRootKey, 'policy', policyId] as const
}

export function policyQuestionnaireQueryKey(policyId: string) {
  return [...policyPlannerQueryRootKey, 'questionnaire', policyId] as const
}

export function policiesListQueryKey() {
  return [...policyPlannerQueryRootKey, 'list'] as const
}

export function policyMarksQueryKey(policyId: string) {
  return [...policyPlannerQueryRootKey, 'marks', policyId] as const
}

export function policyResearchQueryKey(policyId: string) {
  return [...policyPlannerQueryRootKey, 'research', policyId] as const
}

export function policyNFTPreviewQueryKey(policyId: string) {
  return [...policyPlannerQueryRootKey, 'nft-preview', policyId] as const
}

export function policyNFTMetadataQueryKey(tokenId: string) {
  return [...policyPlannerQueryRootKey, 'nft-metadata', tokenId] as const
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function getPolicy(policyId: string): Promise<PolicyDetail> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyDetail>(`/api/v1/policies/${policyId}`)
  )
  return data
}

export async function listPolicies(): Promise<PolicyListItem[]> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyListItem[]>('/api/v1/policies')
  )
  return data
}

export async function getPolicyResearch(
  policyId: string
): Promise<PolicyResearch> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyResearch>(`/api/v1/policies/${policyId}/research`)
  )
  return data
}

export async function getPolicyMarks(policyId: string): Promise<PolicyMarks> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyMarks>(`/api/v1/policies/${policyId}/marks`)
  )
  return data
}

export async function getPolicyOracleStatus(
  policyId: string
): Promise<PolicyOracleStatus> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyOracleStatus>(
      `/api/v1/policies/${policyId}/oracle-status`
    )
  )
  return data
}

/**
 * Admin-only: enqueue settlement for an active policy.
 * Returns 202 Accepted with {status: 'queued'}.
 */
export async function triggerSettle(
  policyId: string
): Promise<{ status: string }> {
  const { data } = await signOutOn401(
    apiClient.post<{ status: string }>(
      `/api/v1/policies/${policyId}/settle`
    )
  )
  return data
}

export async function getPolicyNFTPreview(policyId: string): Promise<string> {
  const { data } = await signOutOn401(
    apiClient.get<string>(`/api/v1/policies/${policyId}/nft/preview`, {
      headers: { Accept: 'image/svg+xml' },
      responseType: 'text',
    })
  )
  return data
}

export async function getPolicyNFTMetadata(
  tokenId: string
): Promise<PolicyNFTMetadata> {
  const { data } = await apiClient.get<PolicyNFTMetadata>(
    `/api/v1/policies/nft/metadata/${encodeURIComponent(tokenId)}`
  )
  return data
}

export function getPolicyNFTMetadataUrl(tokenId: string): string {
  const path = `/api/v1/policies/nft/metadata/${encodeURIComponent(tokenId)}`
  return apiClient.getUri({ url: path })
}

export async function confirmPolicyNFTMint(variables: {
  policyId: string
  nftTokenId: string
  mintTx?: string
}): Promise<PolicyDetail> {
  const body: { nftTokenId: string; mintTx?: string } = {
    nftTokenId: variables.nftTokenId,
  }
  if (variables.mintTx) {
    body.mintTx = variables.mintTx
  }
  const { data } = await signOutOn401(
    apiClient.post<PolicyDetail>(
      `/api/v1/policies/${variables.policyId}/nft/confirm-mint`,
      body
    )
  )
  return data
}

export async function getPolicyQuestionnaire(
  policyId: string
): Promise<PolicyQuestionnaire> {
  const { data } = await signOutOn401(
    apiClient.get<PolicyQuestionnaire>(
      `/api/v1/policies/${policyId}/questionnaire`
    )
  )
  return data
}

export async function submitPolicyIntake(variables: {
  policyId: string
  answers: PolicyIntakeAnswer[]
}): Promise<PolicyDetail> {
  const { data } = await signOutOn401(
    apiClient.post<PolicyDetail>(
      `/api/v1/policies/${variables.policyId}/intake`,
      { answers: variables.answers }
    )
  )
  return data
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

function isTerminalPolicyStatus(status: string): boolean {
  return (
    status === 'proposed' ||
    status === 'funded' ||
    status === 'active' ||
    status === 'settled' ||
    status === 'failed'
  )
}

export function usePolicyQuery(
  policyId: string | undefined,
  options?: { enabled?: boolean; pollSettled?: boolean }
) {
  return useQuery({
    queryKey: policyQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicy(policyId as string),
    enabled: Boolean(policyId) && (options?.enabled ?? true),
    // Self-stopping poll: while questionnaire generating OR composing
    refetchInterval: (query) => {
      const policy = query.state.data
      if (!policy) return false
      // Poll while intake + questionnaire not ready
      if (policy.status === 'intake' && !policy.questionnaireReady) {
        return QUESTIONNAIRE_POLL_MS
      }
      // Poll while composing (in case SSE drops)
      if (policy.status === 'composing') {
        return QUESTIONNAIRE_POLL_MS
      }
      // Poll active policies awaiting settlement
      if (options?.pollSettled && policy.status === 'active') {
        return 15_000
      }
      return false
    },
    retry: retryUnlessClientError,
  })
}

export function usePoliciesQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: policiesListQueryKey(),
    queryFn: listPolicies,
    enabled: options?.enabled ?? true,
    retry: retryUnlessClientError,
  })
}

const MARKS_POLL_MS = 30_000
const MARKS_POLL_ERROR_MS = 60_000
const RESEARCH_POLL_MS = 3_000

export function usePolicyResearchQuery(
  policyId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: policyResearchQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicyResearch(policyId as string),
    enabled: Boolean(policyId) && (options?.enabled ?? true),
    refetchInterval: (query) => {
      if (query.state.data?.searchStatus === 'searching') {
        return RESEARCH_POLL_MS
      }
      return false
    },
    retry: retryUnlessClientError,
  })
}

export function usePolicyMarksQuery(
  policyId: string | undefined,
  options?: { enabled?: boolean; status?: string }
) {
  const isActive = options?.status === 'active'
  return useQuery({
    queryKey: policyMarksQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicyMarks(policyId as string),
    enabled: Boolean(policyId) && isActive && (options?.enabled ?? true),
    refetchInterval: (query) => {
      if (!isActive) return false
      // Back off while the last fetch failed to avoid hammering a down upstream.
      if (query.state.error) return MARKS_POLL_ERROR_MS
      return MARKS_POLL_MS
    },
    retry: (failureCount, error) => {
      // Graceful degrade: 404 means marks endpoint not deployed yet
      if (
        error &&
        typeof error === 'object' &&
        'response' in error &&
        (error as { response?: { status?: number } }).response?.status === 404
      ) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useNFTPreviewQuery(
  policyId: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: policyNFTPreviewQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicyNFTPreview(policyId as string),
    enabled: Boolean(policyId) && enabled,
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
  })
}

export function useNFTMetadataQuery(
  tokenId: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: policyNFTMetadataQueryKey(tokenId ?? 'none'),
    queryFn: () => getPolicyNFTMetadata(tokenId as string),
    enabled: Boolean(tokenId) && enabled,
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
  })
}

export function usePolicyQuestionnaireQuery(
  policyId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: policyQuestionnaireQueryKey(policyId ?? 'none'),
    queryFn: () => getPolicyQuestionnaire(policyId as string),
    enabled: Boolean(policyId) && (options?.enabled ?? true),
    staleTime: Infinity,
    retry: retryUnlessClientError,
  })
}

export function useSubmitPolicyIntakeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: submitPolicyIntake,
    onSuccess: (policy) => {
      queryClient.setQueryData(policyQueryKey(policy.id), policy)
    },
  })
}

// ---------------------------------------------------------------------------
// M2: Select portfolio & Confirm-open API
// ---------------------------------------------------------------------------

export async function selectPortfolio(variables: {
  policyId: string
  portfolioId: string
  premium?: number
  positionOverrides?: Array<{ marketRef: string; weightBps: number }>
}): Promise<PolicyFundingPlan> {
  const body: {
    portfolioId: string
    premium?: number
    positionOverrides?: Array<{ marketRef: string; weightBps: number }>
  } = {
    portfolioId: variables.portfolioId,
  }
  if (variables.premium != null) {
    body.premium = variables.premium
  }
  if (variables.positionOverrides?.length) {
    body.positionOverrides = variables.positionOverrides
  }
  const { data } = await signOutOn401(
    apiClient.post<PolicyFundingPlan>(
      `/api/v1/policies/${variables.policyId}/select`,
      body
    )
  )
  return data
}

export async function confirmOpen(variables: {
  policyId: string
  onChainPolicyId: string
  openTx: string
}): Promise<PolicyDetail> {
  const { data } = await signOutOn401(
    apiClient.post<PolicyDetail>(
      `/api/v1/policies/${variables.policyId}/confirm-open`,
      { onChainPolicyId: variables.onChainPolicyId, openTx: variables.openTx }
    )
  )
  return data
}

// ---------------------------------------------------------------------------
// Compose progress: project Agent Task events (compose/stream is gone)
// ---------------------------------------------------------------------------

export interface PolicyComposeStreamState {
  reasoningText: string
  search: MarketSearchProgress | null
  error: Error | null
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)

    const handleAbort = () => {
      window.clearTimeout(timeoutId)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function asMarketSearchProgress(
  data: Record<string, unknown>
): MarketSearchProgress | null {
  const platforms = data.platforms
  const items = data.items
  if (!Array.isArray(platforms) || !Array.isArray(items)) {
    return null
  }
  const totalCount =
    typeof data.totalCount === 'number' && Number.isFinite(data.totalCount)
      ? data.totalCount
      : items.length
  return {
    platforms: platforms as MarketSearchProgress['platforms'],
    items: items as MarketSearchProgress['items'],
    totalCount,
  }
}

function isComposeProgressTerminal(event: AgentEvent): {
  terminal: boolean
  failed: boolean
  message?: string
} {
  if (
    event.eventType === 'approval.created' &&
    event.data.kind === 'select_portfolio'
  ) {
    return { terminal: true, failed: false }
  }
  if (event.eventType === 'task.failed') {
    return {
      terminal: true,
      failed: true,
      message:
        typeof event.data.message === 'string'
          ? event.data.message
          : '保单编排失败',
    }
  }
  if (
    event.eventType === 'step.failed' &&
    (event.data.step === 'compose' || event.data.step === 'market_search')
  ) {
    return {
      terminal: true,
      failed: true,
      message:
        typeof event.data.code === 'string'
          ? event.data.code
          : '保单编排失败',
    }
  }
  return { terminal: false, failed: false }
}

/**
 * Live search/reasoning while a policy is composing.
 * Progress is sourced from Agent Task durable events (not /compose/stream).
 */
export function usePolicyComposeStream(
  policyId: string | undefined,
  options: { enabled: boolean; reconnectDelayMs?: number }
): PolicyComposeStreamState {
  const queryClient = useQueryClient()
  const [reasoningText, setReasoningText] = useState('')
  const [search, setSearch] = useState<MarketSearchProgress | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_500

  useEffect(() => {
    if (!policyId || !options.enabled) {
      return
    }

    let active = true
    const controller = new AbortController()
    const activePolicyId = policyId

    const refetchSnapshot = async () => {
      const snapshot = await queryClient.fetchQuery({
        queryKey: policyQueryKey(activePolicyId),
        queryFn: () => getPolicy(activePolicyId),
        staleTime: 0,
      })
      if (active && !controller.signal.aborted) {
        queryClient.setQueryData(policyQueryKey(activePolicyId), snapshot)
      }
      return snapshot
    }

    const applyProgressEvent = (event: AgentEvent): boolean => {
      if (event.eventType === 'research.updated') {
        const progress = asMarketSearchProgress(event.data)
        if (progress) {
          setError(null)
          setSearch(progress)
          agentDebug('compose progress search', {
            policyId: activePolicyId,
            platforms: progress.platforms,
            itemCount: progress.items.length,
          })
        } else {
          agentDebug('compose research.updated', {
            policyId: activePolicyId,
            ...summarizeAgentEvent(event),
          })
        }
        return false
      }
      if (event.eventType === 'activity') {
        const crumb = event.data.crumb
        if (typeof crumb === 'string' && crumb.length > 0) {
          setError(null)
          setReasoningText((current) => current + crumb)
          agentDebug('compose progress reasoning', {
            policyId: activePolicyId,
            crumb:
              crumb.length > 120 ? `${crumb.slice(0, 120)}…` : crumb,
          })
        }
        return false
      }
      const outcome = isComposeProgressTerminal(event)
      if (outcome.terminal) {
        agentDebug('compose progress terminal', {
          policyId: activePolicyId,
          failed: outcome.failed,
          message: outcome.message,
          ...summarizeAgentEvent(event),
        })
      }
      return outcome.terminal
    }

    const run = async () => {
      setReasoningText('')
      setSearch(null)
      setError(null)
      agentDebug('compose progress start', { policyId: activePolicyId })

      while (active && !controller.signal.aborted) {
        try {
          const task = await getAgentTaskByPolicy(activePolicyId)
          if (!active || controller.signal.aborted) return
          agentDebug('compose progress resolved task', {
            policyId: activePolicyId,
            taskId: task.id,
            status: task.status,
            recentEvents: task.recentEvents?.length ?? 0,
          })

          // Replay recent durable events for late subscribers.
          let cursor = 0
          for (const event of task.recentEvents ?? []) {
            cursor = Math.max(cursor, event.sequence)
            if (applyProgressEvent(event)) {
              const outcome = isComposeProgressTerminal(event)
              if (outcome.failed) {
                setError(new Error(outcome.message ?? '保单编排失败'))
              }
              await refetchSnapshot()
              return
            }
          }

          let finished = false
          await streamAgentEvents({
            taskId: task.id,
            afterSequence: cursor,
            signal: controller.signal,
            onEvent: (event) => {
              cursor = Math.max(cursor, event.sequence)
              if (!applyProgressEvent(event)) return
              finished = true
              const outcome = isComposeProgressTerminal(event)
              if (outcome.failed) {
                setError(new Error(outcome.message ?? '保单编排失败'))
              }
              controller.abort()
            },
          })

          if (!active) return
          await refetchSnapshot()
          if (finished) return

          const snapshot = await refetchSnapshot()
          if (!active || controller.signal.aborted) return
          if (isTerminalPolicyStatus(snapshot.status)) {
            agentDebug('compose progress done via policy snapshot', {
              policyId: activePolicyId,
              status: snapshot.status,
            })
            return
          }

          agentDebug('compose progress reconnect', {
            policyId: activePolicyId,
            cursor,
          })
          await waitForReconnect(controller.signal, reconnectDelayMs)
        } catch (streamError) {
          if (!active || isAbortError(streamError)) {
            try {
              const snapshot = await refetchSnapshot()
              if (isTerminalPolicyStatus(snapshot.status)) return
            } catch {
              // ignore snapshot errors on abort path
            }
            return
          }
          agentDebugWarn('compose progress error; retrying', {
            policyId: activePolicyId,
            error:
              streamError instanceof Error
                ? streamError.message
                : String(streamError),
          })
          setError(toError(streamError))
          try {
            const snapshot = await refetchSnapshot()
            if (!active || controller.signal.aborted) return
            if (isTerminalPolicyStatus(snapshot.status)) return
          } catch (snapshotError) {
            if (!active || isAbortError(snapshotError)) return
            setError(toError(snapshotError))
          }
          try {
            await waitForReconnect(controller.signal, reconnectDelayMs)
          } catch (reconnectError) {
            if (!active || isAbortError(reconnectError)) return
            setError(toError(reconnectError))
          }
        }
      }
    }

    void run()

    return () => {
      agentDebug('compose progress cleanup', { policyId: activePolicyId })
      active = false
      controller.abort()
    }
  }, [policyId, options.enabled, queryClient, reconnectDelayMs])

  return {
    reasoningText: options.enabled ? reasoningText : '',
    search: options.enabled ? search : null,
    error: options.enabled ? error : null,
  }
}

// ---------------------------------------------------------------------------
// WorldMonitor global context
// ---------------------------------------------------------------------------

export async function fetchWorldContext(): Promise<WorldContext> {
  const { data } = await signOutOn401(
    apiClient.get<WorldContext>('/api/v1/world-context')
  )
  return data
}

export function useWorldContextQuery() {
  return useQuery({
    queryKey: ['world-context'],
    queryFn: fetchWorldContext,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessClientError,
  })
}

// ---------------------------------------------------------------------------
// PandaAI financial context
// ---------------------------------------------------------------------------

export interface PandaSignal {
  kind: string
  label: string
  value: string
  detail?: string
  symbol?: string
  asOf?: string
}

export interface PandaContext {
  source: 'pandaai' | 'unavailable' | 'disabled'
  freshness: string
  summary: string
  signals: PandaSignal[]
  modules: string[]
  lastTradeDate: string | null
  error: string | null
  latencyMs: number
}

export interface PandaModuleInfo {
  id: string
  label: string
  description: string
}

export interface PandaStatus {
  enabled: boolean
  configured: boolean
  modules: string[]
  availableModules: PandaModuleInfo[]
}

export async function fetchPandaContext(
  modules?: string[]
): Promise<PandaContext> {
  const params =
    modules && modules.length > 0
      ? { modules: modules.join(',') }
      : modules && modules.length === 0
        ? { modules: '' }
        : undefined
  const { data } = await signOutOn401(
    apiClient.get<PandaContext>('/api/v1/panda-context', { params })
  )
  return data
}

export async function fetchPandaStatus(): Promise<PandaStatus> {
  const { data } = await signOutOn401(
    apiClient.get<PandaStatus>('/api/v1/panda-context/status')
  )
  return data
}

export function usePandaContextQuery(modules?: string[]) {
  const key = modules ? modules.join(',') : '__server__'
  return useQuery({
    queryKey: ['panda-context', key],
    queryFn: () => fetchPandaContext(modules),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessClientError,
  })
}

export function usePandaStatusQuery() {
  return useQuery({
    queryKey: ['panda-status'],
    queryFn: fetchPandaStatus,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: retryUnlessClientError,
  })
}
