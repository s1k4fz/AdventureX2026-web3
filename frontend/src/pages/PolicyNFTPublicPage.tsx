import { ExternalLink, Gem, Home, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { PageReveal } from '@/components/PageReveal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPolicyNFTMetadataUrl,
  type PolicyNFTAttribute,
  useNFTMetadataQuery,
} from '@/features/policy/policyApi'
import { isCanonicalPolicyNFTTokenId } from '@/features/policy/policyNftUtils'
import {
  EXPLORER_BASE,
  POLICY_NFT_ADDRESS,
} from '@/features/wallet/viemClients'

function formatAttribute(attribute: PolicyNFTAttribute): string {
  if (attribute.display_type === 'date' && typeof attribute.value === 'number') {
    return new Date(attribute.value * 1000).toLocaleDateString('zh-CN')
  }
  return String(attribute.value)
}

function PublicPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <PageReveal className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="units-text-title inline-flex items-center gap-2 text-foreground"
          >
            <img src="/logo.svg" alt="" className="size-5 rounded-[5px]" />
            xEngine
          </Link>
          <Badge
            variant="outline"
            className="rounded-full border-[var(--units-stroke-color)] shadow-none"
          >
            <ShieldCheck />
            Injective EVM
          </Badge>
        </header>
        {children}
      </PageReveal>
    </main>
  )
}

export function PolicyNFTPublicPage() {
  const { tokenId = '' } = useParams<{ tokenId: string }>()
  const validTokenId = isCanonicalPolicyNFTTokenId(tokenId)
  const metadataQuery = useNFTMetadataQuery(tokenId, validTokenId)

  if (!validTokenId) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="units-text-section">
              无效的 Policy NFT Token ID
            </CardTitle>
            <CardDescription className="units-text-body-sm">
              Token ID 必须是 UUID 对应的十进制整数。
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="rounded-full shadow-none">
              <Link to="/">
                <Home data-icon="inline-start" />
                返回首页
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </PublicPageShell>
    )
  }

  if (metadataQuery.isPending) {
    return (
      <PublicPageShell>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-[var(--units-radius)]" />
          <Card>
            <CardHeader>
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-16 w-full" />
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton
                  key={index}
                  className="h-16 w-full rounded-[var(--units-radius-sm)]"
                />
              ))}
            </CardContent>
          </Card>
        </div>
      </PublicPageShell>
    )
  }

  if (metadataQuery.isError || !metadataQuery.data) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="units-text-section">
              Policy NFT 尚不可用
            </CardTitle>
            <CardDescription className="units-text-body-sm">
              该 Token 不存在、尚未完成链上铸造，或 Metadata 服务暂时不可用。
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="rounded-full shadow-none">
              <Link to="/">
                <Home data-icon="inline-start" />
                返回首页
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </PublicPageShell>
    )
  }

  const metadata = metadataQuery.data
  const metadataUrl = getPolicyNFTMetadataUrl(tokenId)
  const explorerUrl = POLICY_NFT_ADDRESS
    ? `${EXPLORER_BASE}/token/${POLICY_NFT_ADDRESS}/instance/${tokenId}`
    : null

  return (
    <PublicPageShell>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.1fr)]">
        <Card className="overflow-hidden py-0">
          <CardContent className="p-3 sm:p-4">
            <div className="relative aspect-square overflow-hidden rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-secondary/20">
              <img
                src={metadata.image}
                alt={metadata.name}
                className="size-full object-cover"
                draggable={false}
              />
              <Badge
                className="absolute left-3 top-3 rounded-full shadow-none"
                variant="secondary"
              >
                <Gem />
                xEngine Policy
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="units-text-title">
              <h1 className="text-inherit">{metadata.name}</h1>
            </CardTitle>
            <CardDescription className="units-text-body leading-relaxed">
              {metadata.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-wash)] px-3 py-2.5">
              <p className="units-text-caption font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Token ID
              </p>
              <p className="units-text-caption mt-1 break-all font-mono">
                {tokenId}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {metadata.attributes.map((attribute) => (
                <div
                  key={`${attribute.trait_type}-${attribute.value}`}
                  className="rounded-[var(--units-radius-sm)] border border-[var(--units-stroke-color)] bg-[var(--units-wash)] px-3 py-2.5"
                >
                  <p className="units-text-caption truncate font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {attribute.trait_type}
                  </p>
                  <p className="units-text-body-sm mt-1 truncate font-semibold">
                    {formatAttribute(attribute)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-full shadow-none">
              <a href={metadataUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink data-icon="inline-end" />
                ERC-721 Metadata
              </a>
            </Button>
            {explorerUrl ? (
              <Button asChild variant="ghost" className="rounded-full shadow-none">
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink data-icon="inline-end" />
                  NFT 浏览器
                </a>
              </Button>
            ) : null}
            <Button asChild className="units-cta rounded-full shadow-none sm:ml-auto">
              <Link to="/login">查看我的保单 NFT</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PublicPageShell>
  )
}
