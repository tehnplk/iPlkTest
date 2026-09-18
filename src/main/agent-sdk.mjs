// agent เวอร์ชัน @openai/agents — ใช้ tool ชุดเดียวกับ loop ที่เขียนเอง
// ต่างกันที่ loop, session และ needsApproval (หยุดถามก่อนรันคำสั่งที่เสี่ยง)
import { OpenAI } from 'openai'
import {
  Agent,
  Runner,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled
} from '@openai/agents'
import { sqlTool, isTemp } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'

const env = (key, fallback = '') => import.meta.env?.[key] ?? process.env[key] ?? fallback

setDefaultOpenAIClient(
  new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env('MAIN_VITE_OPENROUTER_API_KEY', 'missing-api-key')
  })
)
setOpenAIAPI('chat_completions') // OpenRouter ไม่มี Responses API
setTracingDisabled(true) // ไม่งั้น SDK ส่ง trace ไป platform ของ OpenAI

// คำสั่งที่ควรถามก่อนรัน: ดึงทั้งตารางแบบไม่จำกัดจำนวน
export const risky = (name, args) =>
  name === 'sql' && /^\s*select\s+\*/i.test(args.sql ?? '') && !/\blimit\b/i.test(args.sql ?? '')

// tool ของเราเป็น JSON schema อยู่แล้ว SDK รับได้ตรงๆ ถ้า strict: false (ไม่ต้องแปลงเป็น zod)
const wrap = (t, ctx) =>
  tool({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: false,
    needsApproval: async (_c, args) => risky(t.name, args),
    execute: async (args) => JSON.stringify(await t.run(args, undefined, ctx))
  })

export async function askAgentSdk(
  messages,
  { instructions, model, downloadsDir, onStep, onDelta, onApproval, signal } = {}
) {
  const agent = new Agent({
    name: 'HOSxP SQL',
    instructions,
    model,
    // พารามิเตอร์เฉพาะ OpenRouter ส่งผ่าน providerData (SDK spread ลง request body ให้)
    modelSettings: { maxTokens: 8192, providerData: { reasoning: { enabled: true } } },
    tools: [sqlTool, excelTool, apiTool, memoryTool].map((t) => wrap(t, { downloadsDir }))
  })

  // ยังไม่ได้ใช้ Session ของ SDK — ส่งบทสนทนาเดิมเป็น item ธรรมดาไปก่อน
  // ข้อจำกัด: tool call ของเทิร์นก่อนไม่ติดไปด้วย (loop ที่เขียนเองทำผ่าน history.mjs)
  const input = messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }))

  const runner = new Runner()
  let step = null
  const script = []

  const drain = async (stream) => {
    for await (const ev of stream) {
      if (ev.type === 'run_item_stream_event') {
        const it = ev.item
        if (it.type === 'tool_call_item') {
          const args = JSON.parse(it.rawItem?.arguments || '{}')
          onStep?.({ sql: args.sql ?? `${it.rawItem?.name}: ${Object.values(args).join(' ')}` })
          step = { sql: args.sql ?? it.rawItem?.name, result: null }
          if (isTemp(args.sql) && !script.includes(args.sql)) script.push(args.sql)
        }
        if (it.type === 'tool_call_output_item') {
          try {
            step = { sql: step?.sql ?? '', result: JSON.parse(it.output) }
          } catch {
            step = { sql: step?.sql ?? '', result: { error: String(it.output) } }
          }
        }
      }
      if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta')
        onDelta?.(ev.data.delta ?? '')
    }
    await stream.completed
  }

  let result = await runner.run(agent, input, { stream: true, maxTurns: 30, signal })
  await drain(result)

  // needsApproval ทำให้ loop หยุดคาไว้ ต้องถามผู้ใช้แล้วสั่งไปต่อ
  while (result.interruptions?.length) {
    for (const i of result.interruptions) {
      const ok = await onApproval?.({ name: i.name, args: String(i.rawItem?.arguments ?? '') })
      ok ? result.state.approve(i) : result.state.reject(i)
    }
    result = await runner.run(agent, result.state, { stream: true, maxTurns: 30, signal })
    await drain(result)
  }

  // คำสั่งที่สร้าง/ใช้ temp table ต้องโชว์ครบทั้งชุด ไม่งั้นผู้ใช้ก็อป SQL ไปรันเองไม่ได้
  if (step && script.length) step = { ...step, sql: script.join(';\n\n') }
  return { role: 'assistant', content: result.finalOutput ?? '', step }
}
