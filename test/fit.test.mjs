import assert from 'node:assert/strict'
import { fit } from '../src/main/fit.mjs'

const size = (o) => JSON.stringify(o).length

// ผลเล็กๆ ต้องผ่านไปทั้งก้อน ไม่แตะอะไรเลย
const small = { columns: ['total'], rows: [['6615']], rowCount: 1 }
assert.equal(fit(small), small)

// SHOW COLUMNS ของตารางกว้าง (100 คอลัมน์ × 6 ช่อง) ยังต้องผ่านครบ ไม่งั้นโมเดลเขียน query ต่อไม่ได้
const showColumns = {
  columns: ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'],
  rows: Array.from({ length: 100 }, (_, i) => [`col_${i}`, 'varchar(50)', 'YES', '', null, '']),
  rowCount: 100
}
assert.equal(fit(showColumns).rows.length, 100)

// select * ตารางกว้าง 200 แถว ต้องถูกตัดให้พอดีเพดาน แต่ยังบอก rowCount จริงและติด note ไว้
const wide = {
  columns: Array.from({ length: 100 }, (_, i) => `c${i}`),
  rows: Array.from({ length: 200 }, () => Array.from({ length: 100 }, () => 'x'.repeat(20))),
  rowCount: 200
}
const cut = fit(wide)
assert.ok(cut.rows.length < 200 && cut.rows.length > 0, 'ต้องเหลือบางแถว ไม่ใช่ตัดทิ้งหมด')
assert.ok(size(cut) <= 20000, `ตัดแล้วต้องไม่เกินเพดาน แต่ได้ ${size(cut)}`)
assert.equal(cut.rowCount, 200, 'rowCount ต้องเป็นจำนวนจริง ไม่ใช่จำนวนที่เหลือ')
assert.equal(cut.truncated, true)
assert.match(cut.note, /200 แถว/)
assert.equal(wide.rows.length, 200, 'ห้ามแก้ของเดิม — จอใช้ก้อนเดียวกันนี้โชว์ตาราง')

// body ยาวๆ ของ rest_api ตัดเป็นข้อความ แต่ status ต้องอยู่ครบ
const api = fit({ status: 200, body: { data: 'y'.repeat(50000) } })
assert.equal(api.status, 200)
assert.equal(typeof api.body, 'string')
assert.ok(size(api) <= 20100)
assert.equal(api.truncated, true)

// ของที่ไม่ใช่ตารางและไม่มี body ปล่อยผ่าน ไม่พัง
assert.deepEqual(fit({ saved: 'คลินิกเบาหวาน = clinic 001' }), {
  saved: 'คลินิกเบาหวาน = clinic 001'
})
assert.equal(fit(null), null)
assert.equal(fit('ข้อความ'), 'ข้อความ')

console.log('fit ok')
