import assert from 'node:assert/strict'
import { lastResult } from '../src/renderer/src/parse.mjs'

// คำสั่งเดียว: ทั้งก้อนคือตาราง
assert.deepEqual(lastResult('sex|total\n2|3493\n1|3118\n'), [
  ['sex', 'total'],
  ['2', '3493'],
  ['1', '3118']
])

// หลายคำสั่ง (temp table): เอาเฉพาะ result ของคำสั่งสุดท้าย
const multi = `command|1
status|affectedRows|insertId
ok|0|
command|2
status|affectedRows|insertId
ok|4|
command|3
sex|total
2|3493
1|3118
`
assert.deepEqual(lastResult(multi), [
  ['sex', 'total'],
  ['2', '3493'],
  ['1', '3118']
])

// ข้อความที่ไม่ใช่ตาราง ต้องไม่พัง
assert.deepEqual(lastResult('db-cli ล้มเหลว: อะไรสักอย่าง'), [['db-cli ล้มเหลว: อะไรสักอย่าง']])

console.log('parse ok')
