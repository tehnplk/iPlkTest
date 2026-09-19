import assert from 'node:assert/strict'
import { openDb, KEEP_DAYS } from '../src/main/db.mjs'

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

// ห้องเปล่าถูกเก็บกวาดตอนเปิดแอป ห้องที่มีข้อความต้องอยู่ครบ
const empty = await db.create('ห้องเปล่า')
assert.equal((await db.list()).length, 2)
assert.equal(await db.purge(), 1, 'purge ต้องบอกจำนวนที่ลบ')
const left = await db.list()
assert.equal(left.length, 1)
assert.ok(!left.some((c) => c.id === empty))

// ประวัติแชทมีอายุ — ห้องที่มีข้อความและยังไม่เกินกำหนดต้องไม่ถูกแตะ
const fresh = await db.create('เพิ่งคุยไป')
await db.save({ id: fresh, title: 'x', messages: [{ role: 'user', content: 'hi' }] })
assert.equal(await db.purge(), 0, 'ห้องที่เพิ่งคุยต้องรอด')
assert.ok((await db.list()).some((c) => c.id === fresh))

// ห้องในคลังไม่หมดอายุ — ตั้งอายุเป็น 0 วันแล้วต้องรอดคนเดียว ส่วนห้องปกติต้องหาย
const kept = await db.create('เก็บเข้าคลัง')
await db.save({ id: kept, title: 'x', messages: [{ role: 'user', content: 'สำคัญ' }] })
await db.archive(kept)
assert.ok(
  (await db.list()).find((c) => c.id === kept).archived,
  'list ต้องบอกสถานะคลังให้ UI แยกแท็บ'
)

// เหลือห้องที่ไม่ได้อยู่ในคลัง 2 ห้อง (ห้องแรกสุดของไฟล์นี้ + fresh) ต้องหายทั้งคู่
assert.equal(await db.purge(0), 2, 'ลบเฉพาะห้องที่ไม่ได้อยู่ในคลัง')
const after = await db.list().then((r) => r.map((c) => c.id))
assert.ok(!after.includes(fresh), 'ห้องปกติที่เกินกำหนดต้องถูกลบ')
assert.ok(after.includes(kept), 'ห้องในคลังต้องอยู่ตลอดไป')

// เอาออกจากคลังแล้วกลับไปนับอายุตามปกติ
await db.archive(kept, false)
assert.equal(await db.purge(0), 1)
assert.ok(!(await db.list()).some((c) => c.id === kept))

assert.equal(KEEP_DAYS, 30, 'ค่าที่ใช้จริงคือ 30 วัน')

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
