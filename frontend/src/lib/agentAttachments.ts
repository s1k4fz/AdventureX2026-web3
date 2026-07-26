import { getFileCategory, type FileCategory } from '@/lib/fileType'

export interface AgentAttachment {
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  category: FileCategory
  previewUrl?: string
  extractedText?: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function serializeAgentMessage(
  text: string,
  attachments: AgentAttachment[]
) {
  if (attachments.length === 0) return text

  const context = attachments
    .map((attachment) => {
      const heading = `文件：${attachment.fileName}（${attachment.mimeType || attachment.category}，${formatBytes(attachment.fileSize)}）`
      if (attachment.extractedText) {
        return `${heading}\n<file_content>\n${attachment.extractedText}\n</file_content>`
      }
      return `${heading}\n[该附件已由用户加入本轮任务；当前文本通道仅提供文件元数据。]`
    })
    .join('\n\n')

  return `${text}\n\n<agent_attachments>\n${context}\n</agent_attachments>`
}

export function parseAgentMessage(content: string): {
  text: string
  attachments: AgentAttachment[]
} {
  const marker = '\n\n<agent_attachments>\n'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) return { text: content, attachments: [] }

  const attachmentBlock = content.slice(markerIndex + marker.length)
  const headings = [
    ...attachmentBlock.matchAll(/文件：(.+?)（(.+?)，([\d.]+ (?:B|KB|MB))）/g),
  ]
  const attachments = headings.map((match, index) => ({
    id: `restored-${index}-${match[1]}`,
    fileName: match[1],
    fileSize: 0,
    mimeType: match[2],
    category: getFileCategory(match[1]),
  }))
  return { text: content.slice(0, markerIndex), attachments }
}

export { formatBytes }
