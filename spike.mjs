// ลอง agent เวอร์ชัน @openai/agents จากบรรทัดคำสั่ง (ตัวเดียวกับที่แอปเรียกเมื่อเลือก engine = sdk)
//   npm run spike -- "มีผู้ป่วยกี่คน แยกตามเพศ"
//   npm run spike -- "รัน SELECT * FROM pttype ไม่ต้องใส่ LIMIT"   ← เคสที่ต้องขออนุมัติ
import { createInterface } from 'node:readline/promises'
import { readFileSync } from 'node:fs'
import { askAgentSdk } from './src/main/agent-sdk.mjs'
import { db } from './src/main/tools/sql.mjs'

const question = process.argv.slice(2).join(' ') || 'มีผู้ป่วยกี่คน แยกตามเพศ'
const t0 = Date.now()
const ms = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`

console.log(`ถาม: ${question}\n`)

const reply = await askAgentSdk([{ role: 'user', content: question }], {
  instructions: readFileSync(new URL('./src/main/prompt.md', import.meta.url), 'utf8'),
  model: process.env.SPIKE_MODEL || 'qwen/qwen3.7-flash',
  downloadsDir: process.env.TEMP || '.',
  onStep: (s) => console.log(ms(), 'รัน', s.sql.replace(/\s+/g, ' ').slice(0, 150)),
  onDelta: () => {},
  onApproval: async ({ name, args }) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (
      await rl.question(`\n${ms()} ขออนุมัติรัน ${name}: ${args} (y/n): `)
    ).toLowerCase()
    rl.close()
    return answer === 'y' || answer === 'yes'
  }
})

console.log(`\n=== คำตอบ ${ms()} ===\n${reply.content}`)
await db.close()
