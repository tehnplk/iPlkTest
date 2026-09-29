import assert from 'node:assert/strict'
import {
  createConversationMemory,
  toModelMessages,
  buildContext,
  relevantMemories,
  summaryPlan,
  transcript,
  RECENT,
  BATCH
} from '../src/main/conversation-memory.mjs'
import { openDb } from '../src/main/db.mjs'

const memories = [
  'คลินิกเบาหวาน = clinic 001',
  'HbA1c = lab_items_code 193',
  'คลินิกความดัน = clinic 002'
]

// เลือกเฉพาะบรรทัดที่เกี่ยว ไม่แนบทั้งก้อน
assert.deepEqual(relevantMemories(memories, 'ผู้ป่วยเบาหวานมีกี่คน'), [
  'คลินิกเบาหวาน = clinic 001'
])
assert.deepEqual(relevantMemories(memories, 'ค่า hba1c เฉลี่ย'), ['HbA1c = lab_items_code 193'])
assert.deepEqual(relevantMemories(memories, 'สวัสดี'), [])

const turn = (i) => [
  { role: 'user', content: `ถาม ${i}` },
  {
    role: 'assistant',
    content: `ตอบ ${i}`,
    modelMessages: [{ role: 'assistant', content: `ตอบ ${i}` }]
  }
]
const messages = Array.from({ length: 15 }, (_, i) => turn(i)).flat() // 30 ข้อความ

// ยังไม่เกิน RECENT + BATCH → ไม่ต้องสรุป
assert.equal(summaryPlan({ messages: messages.slice(0, RECENT + BATCH), summarized: 0 }), null)
// เกิน → ย่อจนเหลือ RECENT ข้อความท้าย และตัดที่ข้อความผู้ใช้
const plan = summaryPlan({ messages, summarized: 0 })
assert.deepEqual(plan, { from: 0, to: messages.length - RECENT })
assert.equal(messages[plan.to].role, 'user')
assert.equal(summaryPlan({ messages, summarized: plan.to }), null)

// system prompt นิ่ง (prefix cache), สรุป + ความจำที่เกี่ยวอยู่ในข้อความ [บริบท] ก่อนคำถามล่าสุด
const ctx = buildContext({
  prompt: 'BASE',
  convo: { messages, summary: 'สรุปเก่า', summarized: plan.to },
  memories,
  text: 'ผู้ป่วยเบาหวานมีกี่คน'
})
assert.equal(ctx.instructions, 'BASE')
assert.equal(ctx.messages.length, RECENT + 2)
assert.deepEqual(ctx.messages.slice(0, RECENT), messages.slice(plan.to))
assert.deepEqual(ctx.messages.at(-1), { role: 'user', content: 'ผู้ป่วยเบาหวานมีกี่คน' })
const note = ctx.messages.at(-2)
assert.equal(note.role, 'user')
assert.match(note.content, /^\[บริบท\]/)
assert.match(note.content, /สรุปเก่า/)
assert.match(note.content, /clinic 001/)
assert.doesNotMatch(note.content, /clinic 002|193/)

// ห้องใหม่: ไม่มีสรุป ไม่มีความจำที่เกี่ยว → ไม่มีข้อความ [บริบท]
assert.deepEqual(buildContext({ prompt: 'BASE', convo: null, memories, text: 'สวัสดี' }), {
  instructions: 'BASE',
  messages: [{ role: 'user', content: 'สวัสดี' }]
})

assert.equal(
  transcript([...turn(1), { role: 'assistant', content: '' }]),
  'ผู้ใช้: ถาม 1\nผู้ช่วย: ตอบ 1'
)

// replay: เทิร์นที่มี tool call ต้องส่งคำสั่ง + ผลลัพธ์กลับครบ, ข้อความเก่าที่ไม่มี modelMessages ยังใช้ได้
const answered = {
  role: 'assistant',
  content: 'ตาราง patient มี hn',
  modelMessages: [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a1', toolName: 'sql' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a1', toolName: 'sql' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'ตาราง patient มี hn' }] }
  ]
}
const ask = { role: 'user', content: 'ตาราง patient มีคอลัมน์อะไร' }
assert.deepEqual(
  toModelMessages([ask, answered, ask]).map((m) => m.role),
  ['user', 'assistant', 'tool', 'assistant', 'user']
)
assert.deepEqual(toModelMessages([ask, { role: 'assistant', content: 'ได้ครับ' }]), [
  ask,
  { role: 'assistant', content: 'ได้ครับ' }
])
assert.deepEqual(toModelMessages([{ role: 'assistant', content: '' }, { role: 'assistant' }]), [])
assert.deepEqual(toModelMessages(), [])

// ทั้ง flow ผ่าน interface: PGlite memory:// + generate ปลอม
const pg = await openDb('memory://')
const prompts = []
const memory = createConversationMemory({
  store: async () => pg,
  prompt: 'BASE',
  generate: async ({ prompt }) => {
    prompts.push(prompt)
    return 'เป้าหมาย: รายงานความดัน'
  }
})
const id = await pg.create('ห้อง')
await pg.append(id, messages.slice(0, 24), 'ห้อง')
await pg.remember('คลินิกเบาหวาน = clinic 001')
const before = await memory.contextFor({ conversationId: id, text: 'เบาหวานกี่คน' })
assert.equal(before.messages.length, 24 + 2) // ยังไม่สรุป + [บริบท] ความจำ + คำถาม
await memory.afterTurn(id)
assert.equal(prompts.length, 1)
assert.match(prompts[0], /ถาม 0/)
assert.doesNotMatch(prompts[0], /ถาม 7\b/) // RECENT ข้อความท้ายไม่ถูกย่อ
const after = await memory.contextFor({ conversationId: id, text: 'เบาหวานกี่คน' })
assert.equal(after.messages.length, RECENT + 2)
assert.match(after.messages.at(-2).content, /รายงานความดัน/)
await memory.afterTurn(id) // ไม่เกินเกณฑ์แล้ว ไม่เรียกโมเดลซ้ำ
assert.equal(prompts.length, 1)
await pg.close()
console.log('conversation memory ok')
