import assert from 'node:assert/strict'
import { appendPersonDetails } from '../src/main/person-details.mjs'

// jev ปลอม: ให้ hook ตามชื่อคอลัมน์ ยกเว้นเทสต์ที่ส่ง decide ของตัวเองเข้าไป
const pick = (by) => async () => by
import { toModelMessages } from '../src/main/history.mjs'

const result = {
  columns: ['hos_guid', 'visits'],
  rows: [
    ['A', '2'],
    ['missing', '1'],
    ['A', '3'],
    [null, '0']
  ],
  rowCount: 10,
  truncated: true
}
const answer = {
  role: 'assistant',
  content: 'รายชื่อผู้ป่วย',
  modelMessages: [{ role: 'tool', content: [{ type: 'tool-result', output: result }] }],
  step: { sql: 'SELECT hos_guid, visits FROM tmp_visits', result }
}
const before = structuredClone(answer)
const enriched = await appendPersonDetails(
  answer,
  async (by, ids) => {
    assert.equal(by, 'hos_guid')
    assert.deepEqual(ids, ['A', 'missing'])
    return [{ id: 'a', cid: 'test-cid', hn: '001', pname: 'นาย', fname: 'ทดสอบ', lname: 'สมมติ' }]
  },
  null,
  pick('hos_guid')
)
assert.deepEqual(answer, before, 'must not mutate agent results/history')
assert.deepEqual(enriched.step.result.columns, [
  'hos_guid',
  'visits',
  'cid',
  'hn',
  'pname',
  'fname',
  'lname'
])
assert.deepEqual(enriched.step.result.rows[0], [
  'A',
  '2',
  'test-cid',
  '001',
  'นาย',
  'ทดสอบ',
  'สมมติ'
])
assert.deepEqual(enriched.step.result.rows[1], ['missing', '1', null, null, null, null, null])
assert.deepEqual(enriched.step.result.rows[2].slice(2), enriched.step.result.rows[0].slice(2))
assert.deepEqual(enriched.step.result.rows[3], [null, '0', null, null, null, null, null])
assert.equal(enriched.step.result.rowCount, 10)
assert.equal(enriched.step.result.truncated, true)
assert.deepEqual(toModelMessages([enriched]), toModelMessages([before]))
// person_id เป็นคีย์ระบุคนอีกตัว และเป็น int ไม่ใช่ string
const byPerson = await appendPersonDetails(
  { step: { result: { columns: ['person_id', 'visits'], rows: [[12, '2']] } } },
  async (by, ids) => {
    assert.equal(by, 'person_id')
    assert.deepEqual(ids, [12])
    return [{ id: 12, cid: null, hn: null, pname: 'นาง', fname: 'ก', lname: 'ข' }]
  },
  null,
  pick('person_id')
)
assert.deepEqual(byPerson.step.result.rows[0], [12, '2', null, null, 'นาง', 'ก', 'ข'])

for (const response of [
  null,
  { step: { result: { columns: ['total'], rows: [['2']] } } },
  { step: { result: { error: 'failed' } } }
]) {
  assert.equal(
    await appendPersonDetails(response, () => assert.fail('unexpected lookup'), null, pick(null)),
    response
  )
}
// jev บอกว่าคีย์นี้ไม่ใช่คน (เช่น vn_stat.hos_guid) ต้องไม่เติมและไม่ยิงฐาน
assert.equal(
  await appendPersonDetails(answer, () => assert.fail('ไม่ควรค้นหา'), null, pick(null)),
  answer
)
// jev ล่ม = undefined ถอยไปเชื่อชื่อคอลัมน์
const fallback = await appendPersonDetails(
  answer,
  async (by) => {
    assert.equal(by, 'hos_guid')
    return []
  },
  null,
  async () => undefined
)
assert.equal(fallback.step.result.columns.length, 7)

await assert.rejects(
  appendPersonDetails(
    answer,
    async () => {
      throw new Error('lookup failed')
    },
    null,
    pick('hos_guid')
  ),
  /lookup failed/
)
await assert.rejects(appendPersonDetails(answer, () => assert.fail('aborted'), AbortSignal.abort()))
console.log('person details ok')
