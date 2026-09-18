import assert from 'node:assert/strict'
import { needsCheck } from '../src/main/check.mjs'

const result = {
  columns: ['sex', 'total'],
  rows: [
    ['2', '3493'],
    ['1', '3118']
  ],
  rowCount: 2
}

// เลขที่ยกมาจากผลลัพธ์ตรงๆ ไม่ต้องเสียเวลาให้โมเดลตรวจ
assert.equal(needsCheck('หญิง 3,493 คน ชาย 3,118 คน', result), false)
// ไม่มีตัวเลขเลย ไม่มีอะไรให้เทียบ
assert.equal(needsCheck('ดึงข้อมูลแยกตามเพศมาให้แล้วครับ', result), false)
// บวกเอง = ต้องตรวจ (เคสที่โมเดลเคยตอบ 7,014 ทั้งที่จริง 6,611)
assert.equal(needsCheck('รวมทั้งหมด 7,014 คน', result), true)
assert.equal(needsCheck('รวม 6,611 คน', result), true)

console.log('check ok')
