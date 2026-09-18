import assert from 'node:assert/strict'
import { openDb } from '../src/main/db.mjs'

const db = await openDb('memory://')

const id = await db.create('การสนทนาใหม่')
assert.ok(id)

await db.save({ id, title: 'หัวข้อ', messages: [{ role: 'user', content: 'สวัสดี' }] })
const second = await db.create('อันที่สอง')

const rows = await db.list()
assert.equal(rows.length, 2)
assert.equal(rows[0].id, second, 'เรียงตาม updated_at ล่าสุดก่อน')

const saved = rows.find((r) => r.id === id)
assert.equal(saved.title, 'หัวข้อ')
assert.deepEqual(saved.messages, [{ role: 'user', content: 'สวัสดี' }])

console.log('db ok')
