import assert from 'node:assert/strict'
import { variablesOnly, runInSandbox, MAX_STATS_ROWS } from '../src/main/tools/stats.mjs'

const rows = [
  ['45', '1', '130'],
  ['60', '2', '145']
]

// ตัวแปรล้วนผ่านไปทั้งก้อน ไม่มีฟิลด์อื่นติดไป
assert.deepEqual(
  variablesOnly({ columns: ['age', 'sex', 'bps'], rows, rowCount: 2, personKey: null }),
  {
    columns: ['age', 'sex', 'bps'],
    rows
  }
)

// คีย์ระบุตัวคน (ตรวจจากที่มาของคอลัมน์ ไม่ใช่ alias) ต้องไม่ออกนอกเครื่อง
assert.match(
  variablesOnly({
    columns: ['x', 'age'],
    rows,
    rowCount: 2,
    personKey: { index: 0, by: 'hos_guid' }
  }).error,
  /hos_guid/
)

// ข้อมูลโดนตัดท้ายห้ามวิเคราะห์ — ผลจะผิดแบบเงียบๆ
assert.match(
  variablesOnly({ columns: ['age'], rows, rowCount: MAX_STATS_ROWS + 1, truncated: true }).error,
  /เกิน/
)
assert.match(variablesOnly({ columns: ['age'], rows: [], rowCount: 0 }).error, /ไม่ได้ข้อมูล/)

// SQL ที่โดนตรวจ privacy ตีกลับ ส่งต่อ error เดิม ไม่ถึง sandbox
assert.deepEqual(variablesOnly({ error: 'blocked' }), { error: 'blocked' })

// ไม่ได้ตั้งค่า Vercel ต้องบอกวิธีตั้ง ไม่ใช่ยิงออกไปทั้งที่ไม่มี token
delete process.env.VERCEL_TOKEN
assert.match((await runInSandbox({ columns: [], rows: [], code: '' })).error, /VERCEL_TOKEN/)

console.log('stats ok')
