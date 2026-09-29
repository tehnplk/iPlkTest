import assert from 'node:assert/strict'
import { reviewAnswer, finalizeAnswer } from '../src/main/answer-review.mjs'
import { selectDisplay } from '../src/main/display-result.mjs'
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
let reviews = 0
let repairs = 0
const matching = await finalizeAnswer(draft, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args)
  },
  revise: async () => {
    repairs++
    throw new Error('not needed')
  }
})
assert.equal(matching.step.toolCallId, 'people')
assert.equal(matching.verification.status, 'guardrail-passed')
assert.equal(reviews, 2)
assert.equal(repairs, 0)
assert.equal(matching.content, draft.content)

// regression: COUNT จากตาราง tmp_ ที่ตัวเลขในคำตอบผิด ต้องถูกสั่งแก้ (เดิม querySql ถูกทับด้วยสคริปต์จน guard ไม่ทำงาน)
const create = {
  toolCallId: 'create',
  toolName: 'sql',
  sql: 'CREATE TEMPORARY TABLE tmp_people AS SELECT hos_guid FROM patient',
  input: { sql: 'CREATE TEMPORARY TABLE tmp_people AS SELECT hos_guid FROM patient' },
  result: { columns: [], rows: [], rowCount: 0 }
}
const temporary = {
  ...people,
  toolCallId: 'tmp',
  sql: 'SELECT COUNT(*) FROM tmp_people',
  input: { sql: 'SELECT COUNT(*) FROM tmp_people' }
}
const tmpSteps = [create, temporary]
const tmpDraft = { ...draft, toolSteps: tmpSteps, step: selectDisplay(tmpSteps).step }
assert.equal((await reviewAnswer({ ...tmpDraft, content: 'มี 900 คน' })).status, 'revise')
const tmpOk = await reviewAnswer({ ...tmpDraft, content: 'มี 6,612 คน' })
assert.equal(tmpOk.status, 'supported')
assert.equal(tmpOk.answer.step.querySql, 'SELECT COUNT(*) FROM tmp_people')

const guard = await reviewAnswer({ ...draft, content: 'มี 900 คน' }, messages)
assert.equal(guard.status, 'revise')

reviews = 0
repairs = 0
const repaired = await finalizeAnswer({ ...draft, content: 'มี 900 คน' }, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args)
  },
  revise: async (answer) => {
    repairs++
    return { ...answer, content: 'มี 6,612 คน' }
  }
})
assert.equal(repaired.verification.status, 'guardrail-passed')
assert.equal(reviews, 2)
assert.equal(repairs, 1)

reviews = 0
repairs = 0
const failed = await finalizeAnswer({ ...draft, content: 'มี 900 คน' }, messages, {
  review: async (...args) => {
    reviews++
    return reviewAnswer(...args)
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
  buildContext: async () => ({ instructions: 'prompt', messages }),
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
await turns.send({ turnId: 'turn', conversationId: 'conversation', text: 'มีผู้ป่วยทั้งหมดกี่คน' })
assert.deepEqual(order, ['run', 'review', 'enrich'])
console.log('answer review ok')
