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

// ลบบทสนทนา
await db.remove(second)
assert.equal((await db.list()).length, 1)

// --- ความจำกลาง ---
assert.deepEqual(await db.memories(), [])

await db.remember('คลินิกเบาหวาน = clinic 001')
await db.remember('HbA1c = lab_items_code 193')
assert.deepEqual(await db.memories(), ['คลินิกเบาหวาน = clinic 001', 'HbA1c = lab_items_code 193'])

// จำซ้ำต้องไม่เพิ่มแถว
const again = await db.remember('HbA1c = lab_items_code 193')
assert.equal(again.total, 2)

assert.ok((await db.remember('   ')).error, 'ข้อความว่างต้องไม่ถูกบันทึก')

// ลืมแบบค้นบางส่วนได้
assert.deepEqual((await db.forget('HbA1c')).forgot, ['HbA1c = lab_items_code 193'])
assert.deepEqual(await db.memories(), ['คลินิกเบาหวาน = clinic 001'])
assert.ok((await db.forget('ไม่มีเรื่องนี้')).error)

console.log('db ok')
