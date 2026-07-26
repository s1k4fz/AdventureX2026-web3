import {
  getSubagentIdentity,
  MAIN_AGENT_IDENTITY,
  PARALLEL_SUBAGENT_KINDS,
  subagentAlias,
  SUBAGENT_IDENTITIES,
} from './subagentIdentity'
import { SUBAGENT_KIND_LABELS, SUBAGENT_KIND_ORDER } from './types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(MAIN_AGENT_IDENTITY.alias === '主理人', 'main agent alias')
assert(subagentAlias('polymarket') === '行情侦察', 'polymarket alias')
assert(subagentAlias('synthesizer') === '情报官', 'synthesizer alias')
assert(
  PARALLEL_SUBAGENT_KINDS.length === 5,
  'five parallel investigators'
)
assert(
  SUBAGENT_KIND_ORDER.every(
    (kind) => SUBAGENT_KIND_LABELS[kind] === SUBAGENT_IDENTITIES[kind].alias
  ),
  'KIND_LABELS must match identity aliases'
)
assert(
  getSubagentIdentity('web').role === '网页检索',
  'web role label'
)

console.log('subagentIdentity smoke tests passed')
