// agent ของแอป — Vercel AI SDK + provider ทางการของ OpenRouter
// approval เป็นฟีเจอร์ในตัว (toolApproval) ไม่ต้องเขียนลูปเอง
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { ToolLoopAgent, tool, jsonSchema, isStepCount } from 'ai'
import { db, sqlTool, isTemp } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { store } from './store.mjs'
import SYSTEM_PROMPT from './prompt.md?raw'

const env = (key, fallback = '') => import.meta.env?.[key] ?? process.env[key] ?? fallback

const openrouter = createOpenRouter({
  // ไม่มีคีย์ก็ยังเปิดแอปได้ — จะไปเด้ง 401 ตอนคุยแทน
  apiKey: env('MAIN_VITE_OPENROUTER_API_KEY', 'missing-api-key')
})

// รายชื่อที่ให้เลือกในหน้าจอ ตัวแรกคือค่าเริ่มต้น
export const MODELS = [
  'z-ai/glm-5.3-flash',
  'qwen/qwen3.7-flash',
  'upstage/solar-pro4',
  'deepseek/deepseek-v4.1-flash'
]

// prompt + ความจำกลางที่ผู้ใช้สั่งให้จำไว้
export async function buildSystem() {
  const saved = await (await store()).memories()
  if (!saved.length) return SYSTEM_PROMPT
  return `${SYSTEM_PROMPT}

# ความจำกลาง (ผู้ใช้เคยสั่งให้จำไว้ ใช้ได้เลยไม่ต้องถามซ้ำ)
${saved.map((m) => `- ${m}`).join('\n')}`
}

export const closeAgent = () => db.close()

// คำสั่งที่ควรถามก่อนรัน: ดึงทั้งตารางแบบไม่จำกัดจำนวน
const risky = (name, input = {}) =>
  name === 'sql' && /^\s*select\s+\*/i.test(input.sql ?? '') && !/\blimit\b/i.test(input.sql ?? '')

// JSON schema เดิมใช้ได้เลยผ่าน jsonSchema() ไม่ต้องเขียน zod ใหม่
const wrap = (t, ctx) =>
  tool({
    description: t.description,
    inputSchema: jsonSchema(t.parameters),
    execute: async (input) => t.run(input, undefined, ctx)
  })

export async function askAgentAi(
  messages,
  { instructions, model, downloadsDir, onStep, onDelta, onApproval, signal } = {}
) {
  const agent = new ToolLoopAgent({
    // กันชื่อโมเดลแปลกปลอม ถ้าไม่อยู่ในรายการให้ใช้ตัวแรก
    model: openrouter(MODELS.includes(model) ? model : MODELS[0]),
    instructions,
    stopWhen: isStepCount(30),
    tools: {
      sql: wrap(sqlTool, { downloadsDir }),
      export_excel: wrap(excelTool, { downloadsDir }),
      rest_api: wrap(apiTool, { downloadsDir }),
      memory: wrap(memoryTool, { downloadsDir })
    },
    toolApproval: ({ toolCall }) =>
      risky(toolCall.toolName, toolCall.input) ? 'user-approval' : undefined
  })

  // ส่งบทสนทนาเดิมเป็นข้อความธรรมดา (ยังไม่ได้แนบ tool call ของเทิร์นก่อน เหมือนฝั่ง sdk)
  const convo = messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }))

  let step = null
  // คำสั่งสำรวจ (DESCRIBE/SHOW) ไม่ควรกลายเป็นตารางที่โชว์ให้ผู้ใช้ ถ้ามี query จริงให้ใช้อันนั้น
  let dataStep = null
  const script = []

  const run = async (input) => {
    // v7: stream() คืน promise ต้อง await ก่อนถึงจะได้ fullStream (ตามเอกสารที่มากับแพ็กเกจ)
    const result = await agent.stream({ messages: input, abortSignal: signal })
    for await (const part of result.fullStream) {
      // fullStream ไม่ throw — API พัง (คีย์ผิด/429/โมเดลหาย) มาเป็น part แล้ว text จะว่างเปล่า
      // ไม่โยนต่อ = ผู้ใช้เห็นคำตอบว่างโดยไม่รู้ว่าพัง
      if (part.type === 'error') throw part.error
      if (part.type === 'text-delta') onDelta?.(part.text ?? '')
      if (part.type === 'tool-call') {
        const sql = part.input?.sql
        onStep?.({ sql: sql ?? `${part.toolName}: ${Object.values(part.input ?? {}).join(' ')}` })
        step = { sql: sql ?? part.toolName, result: null }
        if (isTemp(sql) && !script.includes(sql)) script.push(sql)
      }
      if (part.type === 'tool-result') {
        step = { sql: step?.sql ?? '', result: part.output }
        if (!/^\s*(show|desc|describe|explain)\b/i.test(step.sql)) dataStep = step
      }
      // tool พังหรือถูกปฏิเสธไม่ได้มาเป็น tool-result — ไม่ดักไว้ result จะค้างเป็น null แล้วหน้าจอโชว์ error ว่างๆ
      if (part.type === 'tool-error')
        step = { sql: step?.sql ?? '', result: { error: String(part.error) } }
      if (part.type === 'tool-output-denied')
        step = { sql: step?.sql ?? '', result: { error: 'ผู้ใช้ไม่อนุมัติให้รันคำสั่งนี้' } }
    }
    return result
  }

  let result = await run(convo)
  let content = await result.content

  // tool ที่ต้องอนุมัติจะหยุดรอ ส่งคำตอบกลับไปเป็นข้อความ role: 'tool'
  for (let round = 0; round < 5; round++) {
    const asks = content.filter((p) => p.type === 'tool-approval-request' && !p.isAutomatic)
    if (!asks.length) break

    const approvals = []
    for (const ask of asks) {
      const ok = await onApproval?.({
        name: ask.toolName ?? ask.toolCall?.toolName ?? 'tool',
        args: JSON.stringify(ask.input ?? ask.toolCall?.input ?? {})
      })
      approvals.push({ type: 'tool-approval-response', approvalId: ask.approvalId, approved: !!ok })
    }

    convo.push(...(await result.responseMessages), { role: 'tool', content: approvals })
    result = await run(convo)
    content = await result.content
  }

  // ถ้ามี query จริงให้โชว์อันนั้น ไม่ใช่ DESCRIBE ที่บังเอิญเป็นคำสั่งสุดท้าย
  const final = dataStep ?? step
  return {
    role: 'assistant',
    content: await result.text,
    step: final && script.length ? { ...final, sql: script.join(';\n\n') } : final
  }
}
