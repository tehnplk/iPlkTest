import assert from 'node:assert/strict'
import { openSql } from '../src/main/tools/sql.mjs'
import { collectToolRun } from '../src/main/tool-run.mjs'
import { createAgentTurns } from '../src/main/agent-turn.mjs'
import { toModelMessages } from '../src/main/conversation-memory.mjs'

// Test through the actual query interface, including the decision-to-execution seam.
let executed = 0
let acquired = 0
const connection = {
  query: async () => {
    executed++
    return [[['1']], [{ name: 'count' }]]
  },
  release() {},
  destroy() {}
}
const driver = {
  createPool: () => ({
    on() {},
    getConnection: async () => {
      acquired++
      return connection
    },
    end: async () => {}
  })
}
const sql = `SELECT ${Array.from({ length: 20 }, (_, i) => `safe_${i}`).join(', ')}, passport_no FROM patient`
const db = openSql({}, { driver })
assert.match((await db.query(sql)).error, /passport_no/)
assert.equal(acquired, 0)
assert.equal(executed, 0)
assert.equal((await db.query(sql.replace('passport_no', 'sex'))).rows[0][0], '1')
assert.equal(executed, 1)
await assert.rejects(db.query('SELECT sex FROM patient', AbortSignal.abort()), {
  name: 'AbortError'
})
assert.equal(executed, 1)
await db.close()

const call = (id, sql, toolName = 'sql') => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: { sql }
})
const result = (id, output) => ({ type: 'tool-result', toolCallId: id, output })
const table = (value) => ({ columns: ['count'], rows: [[value]], rowCount: 1 })
const stream =
  (events, responseMessages = []) =>
  async () => ({
    fullStream: (async function* () {
      yield* events
    })(),
    text: 'done',
    responseMessages
  })
const responseMessages = [{ role: 'assistant', content: 'original replay' }]
const answer = await collectToolRun(
  stream(
    [
      call('a', 'SELECT A'),
      call('b', 'SELECT B'),
      result('b', table('B')),
      result('a', table('A')),
      call('memory', undefined, 'memory'),
      result('memory', { saved: 'a fact' }),
      call('web', undefined, 'web_search'),
      result('web', { results: [] })
    ],
    responseMessages
  )
)
assert.equal(answer.step.sql, 'SELECT A')
assert.deepEqual(answer.step.result, table('A'))
assert.deepEqual(answer.modelMessages, responseMessages)
assert.equal(answer.toolSteps[0].sql, 'SELECT B')

const selected = await collectToolRun(
  stream([
    call('table', 'SELECT A'),
    result('table', table('A')),
    call('chart', 'SELECT B', 'render_chart'),
    result('chart', { chart: { type: 'bar' } }),
    call('broken', 'SELECT C'),
    { type: 'tool-error', toolCallId: 'broken', error: 'failed' },
    call('metadata', 'SHOW TABLES'),
    result('metadata', table('metadata'))
  ])
)
assert.equal(selected.step.toolName, 'render_chart')
assert.equal(selected.toolSteps.find((s) => s.toolCallId === 'broken').sql, 'SELECT C')

const script = await collectToolRun(
  stream([
    call('create1', 'CREATE TEMPORARY TABLE tmp_a (x int)'),
    result('create1', { columns: [], rows: [] }),
    call('insert1', 'INSERT INTO tmp_a VALUES (1)'),
    result('insert1', { error: 'retry' }),
    call('insert2', 'INSERT INTO tmp_a VALUES (1)'),
    result('insert2', { columns: [], rows: [] }),
    call('select', 'SELECT x FROM tmp_a'),
    result('select', table('1'))
  ])
)
assert.equal(
  script.step.sql,
  'CREATE TEMPORARY TABLE tmp_a (x int);\n\nINSERT INTO tmp_a VALUES (1);\n\nSELECT x FROM tmp_a'
)
assert.equal(script.step.querySql, 'SELECT x FROM tmp_a')

const stopped = await collectToolRun(
  stream([
    { type: 'text-delta', text: 'partial ' },
    call('done', 'SELECT A'),
    result('done', table('A')),
    call('unfinished', 'SELECT B'),
    { type: 'text-delta', text: 'answer' },
    { type: 'abort' }
  ])
)
assert.equal(stopped.status, 'stopped')
assert.match(stopped.content, /partial answer/)
assert.deepEqual(stopped.step.result, table('A'))
const replay = toModelMessages([stopped])
assert.ok(!JSON.stringify(replay).includes('unfinished'))
assert.equal(replay.filter((message) => message.role === 'tool').length, 1)

await assert.rejects(
  collectToolRun(stream([{ type: 'error', error: new Error('provider failed') }])),
  /provider failed/
)

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const request = (turnId) => ({ turnId, conversationId: 'original', text: 'hi' })
const context = (instructions) => ({ instructions, messages: [] })
const prompt = deferred()
let runs = 0
const turns = createAgentTurns({
  buildContext: () => prompt.promise,
  run: async () => {
    runs++
    return answer
  },
  enrich: async (value) => value
})
const first = turns.send(request('one'))
await assert.rejects(turns.send(request('two')), /กำลังทำอยู่/)
turns.stop('wrong-id')
turns.stop('one')
prompt.resolve(context('prompt'))
assert.equal((await first).status, 'stopped')
assert.equal(runs, 0)
assert.equal((await turns.send(request('two'))).content, 'done')

let failPrompt = true
const retry = createAgentTurns({
  buildContext: async () => {
    if (failPrompt) throw new Error('prompt failed')
    return context('prompt')
  },
  run: async () => answer,
  enrich: async (value) => value
})
// error หลังเริ่มเทิร์นกลายเป็นคำตอบ status error (ถูกบันทึก) และไม่ค้างเทิร์นถัดไป
const failed = await retry.send(request('one'))
assert.equal(failed.status, 'error')
assert.match(failed.content, /prompt failed/)
failPrompt = false
assert.equal((await retry.send(request('two'))).content, 'done')

// main บันทึกเทิร์นเอง; person lookup ล้มไม่ทำให้คำตอบหาย; บันทึกล้มยังได้คำตอบ + saveError
const saves = []
let failSave = false
const owner = createAgentTurns({
  buildContext: async () => context('prompt'),
  run: async () => answer,
  enrich: async () => {
    throw new Error('mysql gone')
  },
  save: async (...args) => {
    if (failSave) throw new Error('disk full')
    saves.push(args)
  }
})
const kept = await owner.send(request('save'))
assert.equal(kept.content, 'done')
assert.deepEqual(saves, [['original', [{ role: 'user', content: 'hi' }, kept], 'hi']])
failSave = true
assert.equal((await owner.send(request('save2'))).saveError, 'disk full')

const enriching = deferred()
const releaseEnrichment = deferred()
const events = []
let lateDelta
const lifecycle = createAgentTurns({
  buildContext: async () => context('prompt'),
  run: async (_messages, { onDelta }) => {
    lateDelta = onDelta
    onDelta('live')
    return answer
  },
  enrich: async () => {
    enriching.resolve()
    await releaseEnrichment.promise
    return answer
  }
})
const pending = lifecycle.send(request('three'), (type, value) => events.push({ type, ...value }))
await enriching.promise
assert.deepEqual(events, [
  { type: 'delta', turnId: 'three', conversationId: 'original', value: 'live' }
])
lifecycle.stop('three')
lateDelta('stale')
releaseEnrichment.resolve()
const stoppedDuringEnrichment = await pending
assert.equal(stoppedDuringEnrichment.status, 'stopped')
assert.deepEqual(stoppedDuringEnrichment.toolSteps, answer.toolSteps)
lateDelta('after completion')
assert.equal(events.length, 1)

for (const phase of ['responseMessages', 'text']) {
  const controller = new AbortController()
  const finalizing = {
    fullStream: (async function* () {
      yield call('orphan', 'SELECT B')
    })(),
    responseMessages: [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'orphan' }] }
    ],
    text: 'partial'
  }
  const value = finalizing[phase]
  Object.defineProperty(finalizing, phase, {
    get() {
      controller.abort()
      return value
    }
  })
  const lateStop = await collectToolRun(async () => finalizing, { signal: controller.signal })
  assert.equal(lateStop.status, 'stopped')
  assert.ok(!JSON.stringify(lateStop.modelMessages).includes('orphan'))
}
console.log('agent architecture ok')
