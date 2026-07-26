/**
 * Split streamed / persisted reasoning into readable stages for Chain-of-Thought UI.
 * Prefers markdown headings; falls back to double-newline paragraphs.
 */

export interface ReasoningStepPart {
  id: string
  title: string
  body: string
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/

export function splitReasoningSteps(content: string): ReasoningStepPart[] {
  const trimmed = content.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return []

  const lines = trimmed.split('\n')
  const hasHeading = lines.some((line) => HEADING_RE.test(line.trim()))

  if (hasHeading) {
    const parts: ReasoningStepPart[] = []
    let currentTitle = '推理'
    let bodyLines: string[] = []
    let index = 0

    const flush = () => {
      const body = bodyLines.join('\n').trim()
      if (!body && parts.length === 0 && currentTitle === '推理') return
      parts.push({
        id: `step-${index}`,
        title: currentTitle,
        body: body || currentTitle,
      })
      index += 1
      bodyLines = []
    }

    for (const line of lines) {
      const match = HEADING_RE.exec(line.trim())
      if (match) {
        flush()
        currentTitle = match[2]?.trim() || `阶段 ${index + 1}`
        continue
      }
      bodyLines.push(line)
    }
    flush()
    return parts.filter((p) => p.body.trim().length > 0)
  }

  const chunks = trimmed
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean)

  if (chunks.length <= 1) {
    return [{ id: 'step-0', title: '思考过程', body: trimmed }]
  }

  return chunks.map((body, index) => {
    const firstLine = body.split('\n')[0]?.trim() ?? ''
    const numbered = /^(\d+)[.、)]\s*(.+)$/.exec(firstLine)
    if (numbered) {
      const rest = body.slice(firstLine.length).trim()
      return {
        id: `step-${index}`,
        title: numbered[2]?.trim() || `步骤 ${numbered[1]}`,
        body: rest || firstLine,
      }
    }
    // Short first line as title when it looks like a label
    if (firstLine.length <= 28 && body.includes('\n')) {
      return {
        id: `step-${index}`,
        title: firstLine.replace(/[:：]\s*$/, ''),
        body: body.slice(firstLine.length).trim() || firstLine,
      }
    }
    return {
      id: `step-${index}`,
      title: `阶段 ${index + 1}`,
      body,
    }
  })
}
