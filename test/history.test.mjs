import assert from 'node:assert/strict'
import { toHistory } from '../src/main/history.mjs'

const stored = [
  { role: 'user', content: 'ผู้ป่วยกี่คน' },
  {
    role: 'assistant',
    content: 'มี 6,615 คนครับ',
    reasoning_details: [{ type: 'reasoning.text', text: '...' }],
    step: { sql: 'SELECT COUNT(*) FROM patient', result: { columns: ['n'], rows: [['6615']] } }
  },
  { role: 'user', content: 'continue' }
]

const h = toHistory(stored)

// user ผ่านตรงๆ, assistant ที่มี step แตกเป็น tool_calls + tool + คำตอบ
assert.deepEqual(
  h.map((m) => m.role),
  ['user', 'assistant', 'tool', 'assistant', 'user']
)

const [, call, tool, answer] = h
assert.equal(call.content, null)
assert.equal(call.tool_calls[0].function.name, 'sql')
assert.deepEqual(JSON.parse(call.tool_calls[0].function.arguments), {
  sql: 'SELECT COUNT(*) FROM patient'
})
assert.equal(tool.tool_call_id, call.tool_calls[0].id, 'id ต้องตรงกัน ไม่งั้น API ตีกลับ')
assert.ok(tool.content.includes('6615'))

// คำตอบจริงต้องไม่มี JSON ผลลัพธ์ปนอยู่ใน content (ต้นเหตุที่โมเดลลอกไปพิมพ์เอง)
assert.equal(answer.content, 'มี 6,615 คนครับ')
assert.ok(answer.reasoning_details)

// ข้อความที่ไม่มี step ต้องไม่ถูกแตก
assert.equal(toHistory([{ role: 'assistant', content: 'สวัสดี' }]).length, 1)

console.log('history ok')
