import assert from 'node:assert/strict'
import { toModelMessages } from '../src/main/history.mjs'

const ask = { role: 'user', content: 'ตาราง patient มีคอลัมน์อะไรบ้าง' }

// เทิร์นที่มี tool call ต้องส่งกลับครบทั้งคำสั่งและผลลัพธ์ ไม่ใช่เหลือแต่ข้อความ
const answered = {
  role: 'assistant',
  content: 'ตาราง patient มี hn, pname, fname ครับ',
  modelMessages: [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a1', toolName: 'sql' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a1', toolName: 'sql' }] },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'ตาราง patient มี hn, pname, fname ครับ' }]
    }
  ]
}

const out = toModelMessages([ask, answered, { role: 'user', content: 'แล้ว hn ซ้ำได้ไหม' }])
assert.deepEqual(
  out.map((m) => m.role),
  ['user', 'assistant', 'tool', 'assistant', 'user'],
  'tool call + ผลลัพธ์ของเทิร์นก่อนต้องอยู่ครบ'
)
assert.equal(out[1].content[0].type, 'tool-call')
assert.equal(out[2].content[0].type, 'tool-result')

// ข้อความเก่าที่ไม่มี modelMessages ยังต้องอ่านได้
assert.deepEqual(toModelMessages([ask, { role: 'assistant', content: 'ได้ครับ' }]), [
  { role: 'user', content: 'ตาราง patient มีคอลัมน์อะไรบ้าง' },
  { role: 'assistant', content: 'ได้ครับ' }
])

// ข้อความว่าง (เทิร์นที่ถูกกดหยุด) ต้องไม่หลุดเข้าไป
assert.deepEqual(toModelMessages([{ role: 'assistant', content: '' }, { role: 'assistant' }]), [])
assert.deepEqual(toModelMessages(), [])

// modelMessages ต้องชนะข้อความล้วน ไม่ใช่ส่งทั้งคู่จนคำตอบซ้ำ
assert.equal(toModelMessages([answered]).length, 3)

console.log('history ok')
