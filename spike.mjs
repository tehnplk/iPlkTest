// ลอง agent เวอร์ชัน @openai/agents จากบรรทัดคำสั่ง (ไม่ผ่านหน้าจอแอป)
//   npm run spike -- "มีผู้ป่วยกี่คน แยกตามเพศ"
//   npm run spike -- "รัน SELECT * FROM pttype ไม่ต้องใส่ LIMIT"   ← เคสที่ต้องขออนุมัติ
import { createInterface } from 'node:readline/promises'
import { agent, runner, closeSpike } from './src/main/agent-sdk.mjs'

const question = process.argv.slice(2).join(' ') || 'มีผู้ป่วยกี่คน แยกตามเพศ'
const t0 = Date.now()
const ms = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`

const ask = async (q) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${q} (y/n): `)).toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes'
}

const show = async (stream) => {
  for await (const ev of stream) {
    if (ev.type !== 'run_item_stream_event') continue
    if (ev.item.type === 'tool_call_item')
      console.log(ms(), 'รัน', String(ev.item.rawItem?.arguments ?? '').slice(0, 150))
    if (ev.item.type === 'tool_call_output_item')
      console.log(ms(), '  →', String(ev.item.output).slice(0, 150))
  }
  await stream.completed
}

console.log(`ถาม: ${question}\n`)
let result = await runner.run(agent, question, { stream: true, maxTurns: 20 })
await show(result)

// tool ที่ตั้ง needsApproval ไว้จะหยุด loop ตรงนี้ รอคนกดอนุมัติแล้วค่อยวิ่งต่อ
while (result.interruptions?.length) {
  for (const i of result.interruptions) {
    const ok = await ask(`\n${ms()} ขออนุมัติรัน ${i.name}: ${i.rawItem?.arguments ?? ''}`)
    ok ? result.state.approve(i) : result.state.reject(i)
  }
  result = await runner.run(agent, result.state, { stream: true, maxTurns: 20 })
  await show(result)
}

console.log(`\n=== คำตอบ ${ms()} ===\n${result.finalOutput ?? ''}`)
await closeSpike()
