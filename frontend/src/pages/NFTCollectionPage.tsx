import { useMemo, useState } from 'react'
import { ArrowRight, Gem, ImageOff, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type PolicyListItem,
  useNFTMetadataQuery,
  useNFTPreviewQuery,
  usePoliciesQuery,
} from '@/features/policy/policyApi'
import { formatUsd } from '@/features/policy/portfolioUtils'
import { policyUuidToTokenId } from '@/features/policy/policyNftUtils'
import { cn } from '@/lib/utils'

type CollectionFilter = 'all' | 'minted' | 'eligible'

const FILTERS: { id: CollectionFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'minted', label: '已铸造' },
  { id: 'eligible', label: '待铸造' },
]

function isEligible(policy: PolicyListItem) {
  return policy.status === 'active' || policy.status === 'settled'
}

function svgToDataUri(svg: string | undefined) {
  return svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : undefined
}

function CollectionArtwork({ policy }: { policy: PolicyListItem }) {
  const derivedTokenId = policyUuidToTokenId(policy.id) ?? undefined
  const tokenId = policy.nftTokenId ?? derivedTokenId
  const preview = useNFTPreviewQuery(policy.id, !policy.hasNft)
  const metadata = useNFTMetadataQuery(tokenId, policy.hasNft && Boolean(tokenId))
  const image = metadata.data?.image ?? svgToDataUri(preview.data)
  const pending = policy.hasNft ? metadata.isPending : preview.isPending

  return (
    <div className="relative aspect-square overflow-hidden border-b border-[var(--units-stroke-color)] bg-secondary/20">
      {pending ? (
        <Skeleton className="size-full rounded-none" />
      ) : image ? (
        <img
          src={image}
          alt={`${policy.title || '保单'} NFT`}
          loading="lazy"
          draggable={false}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageOff className="size-7" />
          <span className="text-xs">预览暂不可用</span>
        </div>
      )}
      <Badge
        className="absolute left-3 top-3 rounded-full shadow-none"
        variant={policy.hasNft ? 'default' : 'secondary'}
      >
        {policy.hasNft ? <ShieldCheck /> : <Sparkles />}
        {policy.hasNft ? '已铸造' : '可铸造'}
      </Badge>
    </div>
  )
}

function CollectionCard({ policy }: { policy: PolicyListItem }) {
  return (
    <article className="group min-w-0 overflow-hidden rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-background transition-[border-color,transform] units-ease hover:-translate-y-0.5 hover:border-[var(--units-stroke-strong)]">
      <CollectionArtwork policy={policy} />
      <div className="flex min-h-44 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="units-text-caption font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              xEngine Policy
            </p>
            <h2 className="units-text-section mt-1 line-clamp-2 text-foreground">
              {policy.title || '未命名保单'}
            </h2>
          </div>
          {policy.selectedPortfolioTier ? (
            <Badge variant="outline" className="rounded-full shadow-none">
              {policy.selectedPortfolioTier}
            </Badge>
          ) : null}
        </div>

        <div className="units-text-caption mt-3 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {policy.premium != null ? <span>保费 {formatUsd(policy.premium)}</span> : null}
          {policy.expectedPayout != null ? (
            <span>最大赔付 {formatUsd(policy.expectedPayout)}</span>
          ) : null}
          {policy.nftMintedAt ? (
            <span>铸造于 {policy.nftMintedAt.slice(0, 10)}</span>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          {policy.hasNft && policy.nftTokenId ? (
            <Button asChild size="sm" variant="outline">
              <Link to={`/nft/${encodeURIComponent(policy.nftTokenId)}`}>公开页</Link>
            </Button>
          ) : (
            <span className="text-[11.5px] text-muted-foreground">每份保单限铸造一枚</span>
          )}
          <Button asChild size="sm" variant={policy.hasNft ? 'ghost' : 'default'}>
            <Link to={`/policy/${policy.id}?tab=nft`}>
              {policy.hasNft ? '查看凭证' : '前往铸造'}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

export function NFTCollectionPage() {
  const policiesQuery = usePoliciesQuery()
  const [filter, setFilter] = useState<CollectionFilter>('all')
  const eligiblePolicies = useMemo(
    () => (policiesQuery.data ?? []).filter(isEligible),
    [policiesQuery.data]
  )
  const mintedCount = eligiblePolicies.filter((policy) => policy.hasNft).length
  const visiblePolicies = eligiblePolicies.filter((policy) => {
    if (filter === 'minted') return policy.hasNft
    if (filter === 'eligible') return !policy.hasNft
    return true
  })

  return (
    <div className="h-full overflow-y-auto units-app-panel">
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-[var(--units-stroke-color)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[var(--units-orange)]">
              <Gem className="size-5" />
              <span className="units-text-caption font-semibold uppercase tracking-[0.12em]">
                Policy NFT
              </span>
            </div>
            <h1 className="units-text-title mt-2 text-foreground">保单藏品</h1>
            <p className="units-text-body-sm mt-2 text-muted-foreground">
              集中查看可铸造与已铸造的链上保障凭证。NFT 代表保单的公开凭证，不改变原保单的结算规则。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-64">
            <div className="rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] bg-[var(--units-soft)] px-4 py-3">
              <p className="units-text-title">{mintedCount}</p>
              <p className="units-text-caption text-muted-foreground">已铸造</p>
            </div>
            <div className="rounded-[var(--units-radius)] border border-[var(--units-stroke-color)] px-4 py-3">
              <p className="units-text-title">
                {eligiblePolicies.length - mintedCount}
              </p>
              <p className="units-text-caption text-muted-foreground">待铸造</p>
            </div>
          </div>
        </header>

        <div className="mt-5 flex gap-1 overflow-x-auto" role="group" aria-label="筛选 NFT">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={cn(
                'h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors',
                filter === item.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {policiesQuery.isPending ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/5] rounded-[var(--units-radius)]" />
            ))}
          </div>
        ) : policiesQuery.isError ? (
          <div className="mt-8 rounded-[var(--units-radius)] border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
            藏品加载失败，请稍后重试。
          </div>
        ) : visiblePolicies.length > 0 ? (
          <div className="units-stagger mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePolicies.map((policy) => (
              <CollectionCard key={policy.id} policy={policy} />
            ))}
          </div>
        ) : (
          <div className="mt-8 flex min-h-64 flex-col items-center justify-center rounded-[var(--units-radius)] border border-dashed border-[var(--units-stroke-color)] px-6 text-center">
            <Gem className="size-9 text-muted-foreground" />
            <h2 className="mt-3 font-display text-lg font-semibold">
              {filter === 'minted' ? '还没有已铸造的 NFT' : '暂无符合条件的保单'}
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              保单在 Injective 测试网上生效后，即可在这里预览并铸造成 ERC-721 凭证。
            </p>
            <Button asChild className="mt-4">
              <Link to="/home">返回保单看板</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
