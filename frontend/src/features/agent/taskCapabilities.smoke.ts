import {
  canProceedToFunding,
  canReviseGoal,
  canSendFreeText,
  isInputLocked,
} from './taskCapabilities'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

assert(!canSendFreeText('monitoring'), 'monitoring must not accept free text')
assert(!canSendFreeText('succeeded'), 'succeeded must not accept free text')
assert(isInputLocked('monitoring'), 'monitoring must lock command dock')
assert(isInputLocked('succeeded'), 'succeeded must lock command dock')
assert(!isInputLocked('waiting_user'), 'waiting_user stays interactive')
assert(canSendFreeText('waiting_user'), 'waiting_user can send free text')
assert(canReviseGoal('running'), 'running can revise goal')
assert(!canReviseGoal('monitoring'), 'monitoring cannot revise goal')
assert(canProceedToFunding('waiting_user'), 'waiting_user can fund')
assert(!canProceedToFunding('monitoring'), 'monitoring cannot start funding')

console.log('taskCapabilities.smoke.ts: ok')
