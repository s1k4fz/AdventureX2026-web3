import { useMemo } from 'react'
import {
  AlertCircle,
  Check,
  Circle,
  ExternalLink,
  Gem,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { TxLink } from '@/features/wallet/TxLink'
import { useTxLockStore } from '@/features/wallet/txLockStore'
import { useWallet } from '@/features/wallet/useWallet'
import {
  POLICY_NFT_ADDRESS,
  POLICY_NFT_CONFIG_ERROR,
} from '@/features/wallet/viemClients'
import { cn } from '@/lib/utils'
import {
  getPolicyNFTMetadataUrl,
  type PolicyDetail,
  type PolicyNFTAttribute,
  useNFTMetadataQuery,
  useNFTPreviewQuery,
} from './policyApi'
import { NFTShareButton } from './NFTShareButton'
import {
  type PolicyNFTMintStep,
  useMintPolicyNFT,
} from './useMintPolicyNFT'
import { onChainPolicyIdToTokenId } from './policyNftUtils'

const MINT_STEP_ORDER: PolicyNFTMintStep[] = [
  'checking',
  'minting',
  'confirming',
  'success',
]

function tokenIdFromPolicy(policy: PolicyDetail): string | undefined {
  if (policy.nftTokenId) return policy.nftTokenId
  if (!policy.onChainPolicyId) return undefined
  return onChainPolicyIdToTokenId(policy.onChainPolicyId) ?? undefined
}

function svgToDataUri(svg: string | undefined): string | undefined {
  if (!svg) return undefined
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function resolveShareUrl(
  externalUrl: string | undefined,
  fallback: string | null
): string | null {
  if (!externalUrl) return fallback
  try {
    const candidate = new URL(externalUrl, window.location.origin)
    const isHttp = candidate.protocol === 'http:' || candidate.protocol === 'https:'
    const isRawMetadata = candidate.pathname.includes(
      '/api/v1/policies/nft/metadata/'
    )
    return isHttp && !isRawMetadata ? candidate.toString() : fallback
  } catch {
    return fallback
  }
}

function formatAttribute(attribute: PolicyNFTAttribute): string {
  if (attribute.display_type === 'date' && typeof attribute.value === 'number') {
    return new Date(attribute.value * 1000).toLocaleDateString('zh-CN')
  }
  return String(attribute.value)
}

function NFTArtwork({
  source,
  alt,
  loading,
}: {
  source?: string
  alt: string
  loading: boolean
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary/30">
      {loading ? (
        <Skeleton className="size-full rounded-none" />
      ) : source ? (
        <img
          src={source}
          alt={alt}
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center">
          <Gem className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            NFT 艺术预览暂时不可用
          </p>
        </div>
      )}
      <Badge className="absolute left-3 top-3" variant="secondary">
        <Sparkles />
        xEngine Policy
      </Badge>
    </div>
  )
}

function MintProgress({
  step,
  mintTx,
  errorMessage,
}: {
  step: PolicyNFTMintStep
  mintTx: string | null
  errorMessage: string | null
}) {
  if (step === 'idle') return null
  const currentIndex = MINT_STEP_ORDER.indexOf(step)
  const failed = step === 'error'
  const steps = [
    { key: 'checking', label: '检查链上状态', step: 'checking' as const },
    { key: 'minting', label: '钱包铸造', step: 'minting' as const },
    { key: 'confirming', label: '同步保单记录', step: 'confirming' as const },
  ]

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-3">
      {steps.map((item) => {
        const itemIndex = MINT_STEP_ORDER.indexOf(item.step)
        const current = step === item.step
        const done = !failed && (currentIndex > itemIndex || step === 'success')
        return (
          <div
            key={item.key}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            {done ? (
              <Check className="size-3.5 text-primary" />
            ) : current ? (
              <Loader2 className="size-3.5 animate-spin text-primary" />
            ) : (
              <Circle className="size-3.5" />
            )}
            <span className={cn(current && 'font-medium text-foreground')}>
              {item.label}
            </span>
            {item.step === 'minting' && mintTx ? (
              <TxLink hash={mintTx} className="ml-auto" />
            ) : null}
          </div>
        )
      })}
      {failed && errorMessage ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}

function NFTAttributes({ attributes }: { attributes: PolicyNFTAttribute[] }) {
  if (attributes.length === 0) return null
  return (
    <Card className="gap-4 py-5 shadow-none">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">链上凭证属性</CardTitle>
        <CardDescription className="text-xs">
          由保单快照生成的 ERC-721 标准 traits
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 px-5 sm:grid-cols-2 xl:grid-cols-3">
        {attributes.map((attribute) => (
          <div
            key={`${attribute.trait_type}-${attribute.value}`}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-secondary/20 px-3 py-2.5"
          >
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {attribute.trait_type}
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {formatAttribute(attribute)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PolicyNFTPanel({ policy }: { policy: PolicyDetail }) {
  const wallet = useWallet()
  const isTxInFlight = useTxLockStore((state) => state.isTxInFlight)
  const mint = useMintPolicyNFT(policy.id)
  const tokenId = tokenIdFromPolicy(policy)
  const minted = Boolean(policy.nftTokenId || mint.step === 'success')
  const effectiveTokenId = policy.nftTokenId ?? mint.tokenId ?? tokenId
  const previewQuery = useNFTPreviewQuery(policy.id, !minted)
  const metadataQuery = useNFTMetadataQuery(
    effectiveTokenId,
    minted && Boolean(effectiveTokenId)
  )
  const previewSource = useMemo(
    () => svgToDataUri(previewQuery.data),
    [previewQuery.data]
  )
  const artwork = metadataQuery.data?.image ?? previewSource
  const metadataUrl = effectiveTokenId
    ? policy.nftMetadataUri ?? getPolicyNFTMetadataUrl(effectiveTokenId)
    : null
  const publicNftUrl = effectiveTokenId
    ? new URL(
        `/nft/${encodeURIComponent(effectiveTokenId)}`,
        window.location.origin
      ).toString()
    : null
  // Honor a configured canonical public origin, while falling back to this
  // app's unauthenticated route if external_url is raw metadata or malformed.
  const shareUrl = resolveShareUrl(
    metadataQuery.data?.external_url,
    publicNftUrl
  )
  const inProgress = ['checking', 'minting', 'confirming'].includes(mint.step)
  const mintBusy = inProgress || isTxInFlight

  const handleMint = () => {
    if (mintBusy || minted || mint.step === 'success') return
    if (wallet.status === 'disconnected' || wallet.status === 'connecting') {
      void wallet.connect()
      return
    }
    if (wallet.isWrongNetwork) {
      void wallet.switchToInjectiveTestnet()
      return
    }
    if (mint.step === 'error') mint.reset()
    void mint.mint()
  }

  const ctaLabel =
    wallet.status === 'disconnected' || wallet.status === 'connecting'
      ? '连接钱包'
      : wallet.isWrongNetwork
        ? '切换至 Injective 测试网'
        : inProgress
          ? mint.step === 'confirming'
            ? '正在同步保单记录…'
            : mint.step === 'checking'
              ? '正在检查链上状态…'
              : '等待钱包确认…'
          : isTxInFlight
            ? '有交易进行中…'
            : mint.step === 'error'
              ? '重试铸造 / 同步'
              : '铸造保单 NFT'

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <Card className="overflow-hidden border-border bg-card py-0 shadow-none">
        <CardContent className="p-3 sm:p-4">
          <NFTArtwork
            source={artwork}
            alt={metadataQuery.data?.name ?? `${policy.title} NFT 预览`}
            loading={
              (!minted && previewQuery.isPending) ||
              (minted && metadataQuery.isPending)
            }
          />
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <Card className="gap-4 py-5 shadow-none">
          <CardHeader className="px-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              {minted ? <ShieldCheck className="size-5" /> : <Gem className="size-5" />}
              {metadataQuery.data?.name ?? '保单 NFT'}
            </CardTitle>
            <CardDescription className="leading-5">
              {metadataQuery.data?.description ??
                '把这份已生效的保障铸造成确定性 ERC-721 凭证。每份保单只能铸造一次。'}
            </CardDescription>
            <CardAction>
              <Badge variant={minted ? 'default' : 'outline'}>
                {minted ? '已铸造' : '待铸造'}
              </Badge>
            </CardAction>
          </CardHeader>

          <CardContent className="flex flex-col gap-4 px-5">
            {effectiveTokenId ? (
              <div className="flex flex-col gap-1 rounded-lg bg-secondary/30 px-3 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Token ID
                </span>
                <span className="break-all font-mono text-xs text-foreground">
                  {effectiveTokenId}
                </span>
              </div>
            ) : null}

            {!minted ? (
              <>
                <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    仅保单链上所有者可以铸造
                  </p>
                  <p className="flex items-center gap-2">
                    <RefreshCw className="size-4 text-primary" />
                    已上链但未入库时会自动恢复同步
                  </p>
                </div>

                {POLICY_NFT_CONFIG_ERROR ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {POLICY_NFT_CONFIG_ERROR}
                  </p>
                ) : !POLICY_NFT_ADDRESS ? (
                  <p className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
                    PolicyNFT 尚未部署或配置。预览可用，铸造将在配置
                    VITE_POLICY_NFT_ADDRESS 后开启。
                  </p>
                ) : null}

                <MintProgress
                  step={mint.step}
                  mintTx={mint.mintTx}
                  errorMessage={mint.errorMessage}
                />
              </>
            ) : (
              <>
                <Separator />
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    铸造时间{' '}
                    {policy.nftMintedAt
                      ? new Date(policy.nftMintedAt).toLocaleString('zh-CN')
                      : '链上已确认'}
                  </span>
                  {policy.nftMintTx || mint.mintTx ? (
                    <span className="inline-flex items-center gap-1">
                      交易
                      <TxLink hash={policy.nftMintTx ?? mint.mintTx} />
                    </span>
                  ) : null}
                </div>
                {mint.recoveredFromChain ? (
                  <p className="text-xs text-primary" role="status">
                    已从链上恢复 NFT，并同步到保单记录。
                  </p>
                ) : null}
              </>
            )}
          </CardContent>

          <CardFooter className="flex-col items-stretch gap-3 px-5 pb-5">
            {!minted ? (
              <Button
                type="button"
                onClick={handleMint}
                aria-busy={mintBusy || undefined}
                disabled={
                  mintBusy ||
                  !POLICY_NFT_ADDRESS ||
                  Boolean(POLICY_NFT_CONFIG_ERROR)
                }
              >
                {mintBusy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <WalletCards data-icon="inline-start" />
                )}
                {ctaLabel}
              </Button>
            ) : metadataUrl && shareUrl && effectiveTokenId ? (
              <NFTShareButton
                title={metadataQuery.data?.name ?? 'xEngine Policy NFT'}
                shareUrl={shareUrl}
                image={metadataQuery.data?.image}
                tokenId={effectiveTokenId}
              />
            ) : null}

            {metadataQuery.isError ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3.5" />
                NFT 已铸造，但 Metadata 暂时加载失败
              </p>
            ) : null}
            {minted && metadataUrl ? (
              <a
                href={metadataUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                查看原始 ERC-721 Metadata
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </CardFooter>
        </Card>

        {metadataQuery.data ? (
          <NFTAttributes attributes={metadataQuery.data.attributes} />
        ) : null}
      </div>
    </div>
  )
}
