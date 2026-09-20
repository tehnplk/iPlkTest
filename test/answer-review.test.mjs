import assert from 'node:assert/strict'
import { countMismatch, reviewAnswer, finalizeAnswer } from '../src/main/answer-review.mjs'
import { createAgentTurns } from '../src/main/agent-turn.mjs'

const people = {
  toolCallId: 'people',
  toolName: 'sql',
  sql: 'SELECT COUNT(DISTINCT hn) FROM patient',
  result: { columns: ['patients'], rows: [['6612']], rowCount: 1 }
}
const rows = {
  toolCallId: 'rows',
  toolName: 'sql',
  sql: 'SELECT COUNT(*) FROM patient',
  result: { columns: ['rows'], rows: [['6615']], rowCount: 1 }
}
const draft = {
  role: 'assistant',
  content: 'ผู้ป่วยทั้งหมด 6,612 คน นับ HN ไม่ซ้ำ',
  step: rows,
  toolSteps: [people, rows],
  modelMessages: [{ role: 'assistant', content: 'draft' }]
}
const messages = [{ role: 'user', content: 'มีผู้ป่วยทั้งหมดกี่คน' }]
const decision = (support, display) => async () => ({
  support: { choice: support },
  display: { choice: display }
})

let reviews = 0
let repairs = 0
const matching = await finalizeAnswer(draft, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args, decision('supported', 'result_0'))
  },
  revise: async () => {
    repairs++
    throw new Error('not needed')
  }
})
assert.equal(matching.step.toolCallId, 'people')
assert.equal(matching.verification.status, 'verified')
assert.equal(reviews, 2)
assert.equal(repairs, 0)
assert.equal(matching.content, draft.content)

const temporary = {
  ...people,
  sql: 'SELECT COUNT(*) FROM tmp_people',
  sqlScript:
    'CREATE TEMPORARY TABLE tmp_people AS SELECT hos_guid FROM patient;\n\nSELECT COUNT(*) FROM tmp_people'
}
const chosenTemporary = await reviewAnswer(
  { ...draft, toolSteps: [temporary, rows] },
  messages,
  undefined,
  decision('supported', 'result_0')
)
assert.equal(chosenTemporary.answer.step.sql, temporary.sqlScript)
assert.equal(chosenTemporary.answer.step.querySql, temporary.sql)

assert.equal(countMismatch('มี 6,612 คน', people), false)
assert.equal(countMismatch('มี ๖,๖๑๒ คน', people), false)
assert.equal(countMismatch('มี 6,615 คน', people), true)
assert.equal(countMismatch('จำนวนตามตาราง', people), false)
const guard = await reviewAnswer(draft, messages, undefined, decision('supported', 'result_1'))
assert.equal(
  guard.status,
  'revise',
  'Numeric guard must override an incorrect positive Jev decision'
)

reviews = 0
repairs = 0
const repaired = await finalizeAnswer({ ...draft, content: 'มี 900 คน' }, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args, decision('supported', 'result_0'))
  },
  revise: async (answer) => {
    repairs++
    return { ...answer, content: 'มี 6,612 คน' }
  }
})
assert.equal(repaired.verification.status, 'verified')
assert.equal(reviews, 2)
assert.equal(repairs, 1)

reviews = 0
repairs = 0
const failed = await finalizeAnswer(draft, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args, decision('revise', 'result_0'))
  },
  revise: async (answer) => {
    repairs++
    return answer
  }
})
assert.equal(failed.verification.status, 'failed')
assert.match(failed.content, /^⚠/)
assert.equal(reviews, 2)
assert.equal(repairs, 1)

for (const answer of [
  null,
  {},
  { support: { choice: 'supported' }, display: { choice: 'invented' } }
]) {
  const unavailable = await finalizeAnswer(draft, messages, {
    review: (...args) => reviewAnswer(...args, async () => answer),
    revise: () => assert.fail('must not retry when reviewer is unavailable')
  })
  assert.equal(unavailable.verification.status, 'unavailable')
  assert.match(unavailable.content, /^⚠/)
}

const stopped = { ...draft, status: 'stopped' }
assert.equal(
  await finalizeAnswer(stopped, messages, { review: () => assert.fail('stopped turn') }),
  stopped
)
const controller = new AbortController()
await assert.rejects(
  finalizeAnswer(draft, messages, {
    signal: controller.signal,
    review: async () => {
      controller.abort()
      return { status: 'supported', answer: draft }
    }
  }),
  { name: 'AbortError' }
)

const order = []
const turns = createAgentTurns({
  buildSystem: async () => 'prompt',
  run: async () => {
    order.push('run')
    return draft
  },
  finalize: async () => {
    order.push('review')
    return matching
  },
  enrich: async (answer) => {
    order.push('enrich')
    assert.equal(answer.step.toolCallId, 'people')
    return answer
  }
})
await turns.send({ turnId: 'turn', conversationId: 'conversation', messages })
assert.deepEqual(order, ['run', 'review', 'enrich'])
console.log('answer review ok')
