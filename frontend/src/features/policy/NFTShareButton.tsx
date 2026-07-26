import { useState } from 'react'
import { Check, Copy, ExternalLink, ImageDown, Share2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  EXPLORER_BASE,
  POLICY_NFT_ADDRESS,
} from '@/features/wallet/viemClients'

type CopyState = 'idle' | 'link' | 'image'

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

async function copyImage(imageUri: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('image clipboard unsupported')
  }
  const response = await fetch(imageUri)
  const source = await response.blob()
  let pngBlob = source

  if (source.type === 'image/svg+xml') {
    const sourceUrl = URL.createObjectURL(source)
    try {
      const image = new Image()
      image.decoding = 'async'
      image.src = sourceUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || 800
      canvas.height = image.naturalHeight || 800
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas unsupported')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('png export failed'))),
          'image/png'
        )
      })
    } finally {
      URL.revokeObjectURL(sourceUrl)
    }
  }

  await navigator.clipboard.write([
    new ClipboardItem({ [pngBlob.type || 'image/png']: pngBlob }),
  ])
}

export function NFTShareButton({
  title,
  shareUrl,
  image,
  tokenId,
}: {
  title: string
  shareUrl: string
  image?: string
  tokenId: string
}) {
  const [copied, setCopied] = useState<CopyState>('idle')
  const [copyError, setCopyError] = useState<string | null>(null)
  const tokenUrl = POLICY_NFT_ADDRESS
    ? `${EXPLORER_BASE}/token/${POLICY_NFT_ADDRESS}/instance/${tokenId}`
    : null
  const tweetUrl = `https://twitter.com/intent/tweet?${new URLSearchParams({
    text: `我的 ${title} 已铸造为 xEngine Policy NFT`,
    url: shareUrl,
  }).toString()}`

  const handleCopy = async (kind: 'link' | 'image') => {
    setCopyError(null)
    try {
      if (kind === 'image' && image) {
        await copyImage(image)
      } else {
        await copyText(shareUrl)
      }
      setCopied(kind)
      window.setTimeout(() => setCopied('idle'), 1800)
    } catch {
      setCopyError(
        kind === 'image'
          ? '浏览器不支持复制图片，可长按或右键保存'
          : '无法访问剪贴板，请手动复制地址'
      )
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleCopy('link')}
        >
          {copied === 'link' ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied === 'link' ? '已复制' : '复制分享链接'}
        </Button>

        {image ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCopy('image')}
          >
            {copied === 'image' ? (
              <Check data-icon="inline-start" />
            ) : (
              <ImageDown data-icon="inline-start" />
            )}
            {copied === 'image' ? '已复制' : '复制图片'}
          </Button>
        ) : null}

        <Button type="button" size="sm" variant="outline" asChild>
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer">
            <Share2 data-icon="inline-start" />
            分享到 X
          </a>
        </Button>

        {tokenUrl ? (
          <Button type="button" size="sm" variant="ghost" asChild>
            <a href={tokenUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink data-icon="inline-start" />
              NFT 浏览器
            </a>
          </Button>
        ) : null}
      </div>
      {copyError ? (
        <p role="status" className="text-xs text-destructive">
          {copyError}
        </p>
      ) : null}
    </div>
  )
}
