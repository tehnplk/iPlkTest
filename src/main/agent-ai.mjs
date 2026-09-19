// agent ของแอป — Vercel AI SDK ยิงผ่าน LiteLLM proxy อย่างเดียว ไม่ต่อ OpenRouter ตรง
// (proxy คุมคีย์ โควตา และสิทธิ์โมเดลรายคนให้ แอปถือแค่ virtual key ของตัวเอง)
// approval เป็นฟีเจอร์ในตัว (toolApproval) ไม่ต้องเขียนลูปเอง
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ToolLoopAgent, tool, jsonSchema, isStepCount } from 'ai'
import { db, listTool, schemaTool, queryTool, isTemp } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { chartTool } from './tools/chart.mjs'
import { fit } from './fit.mjs'
import { store } from './store.mjs'
import SYSTEM_PROMPT from './prompt.md?raw'

const env = (key, fallback = '') => process.env[key] ?? fallback

// base url ไม่มีค่าเริ่มต้น — แต่ละเครื่อง/แต่ละที่ตั้ง proxy คนละที่ ต้องมาจาก .env เท่านั้น
const BASE_URL = env('LLM_BASE_URL')
const llm = createOpenAICompatible({
  name: 'litellm',
  baseURL: BASE_URL,
  // ตั้งค่าไม่ครบก็ยังเปิดแอปได้ — ไปเด้งตอนคุยแทน จะได้ไม่เปิดแอปไม่ขึ้นทั้งตัว
  apiKey: env('LLM_API_KEY', 'missing-api-key')
})

// ชื่อโมเดลเป็นของ proxy (คนละชุดกับชื่อ OpenRouter) และต่าง key ก็ได้สิทธิ์คนละรายการ
// ดูของจริงที่ GET /v1/models — ตัวแรกคือค่าเริ่มต้นบนหน้าจอ
export const MODELS = env('LLM_MODELS', 'flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

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
  name === 'query_data' &&
  /^\s*select\s+\*/i.test(input.sql ?? '') &&
  !/\blimit\b/i.test(input.sql ?? '')

// tool สำรวจ (หาชื่อตาราง/ดูคอลัมน์) ไม่ใช่ผลลัพธ์ที่ผู้ใช้อยากเห็นเป็นตารางบนจอ
const EXPLORE = ['list_table_name', 'get_table_schema']

// JSON schema เดิมใช้ได้เลยผ่าน jsonSchema() ไม่ต้องเขียน zod ใหม่
const wrap = (t, ctx) =>
  tool({
    description: t.description,
    inputSchema: jsonSchema(t.parameters),
    execute: async (input) => t.run(input, undefined, ctx),
    toModelOutput: ({ output }) => ({ type: 'json', value: fit(output) })
  })

export async function askAgentAi(
  messages,
  { instructions, model, downloadsDir, onStep, onDelta, onApproval, signal } = {}
) {
  if (!BASE_URL)
    throw new Error(
      'ยังไม่ได้ตั้ง LLM_BASE_URL ใน .env — ใส่ base url ของ LiteLLM proxy เช่น http://localhost:4000/v1 แล้วเปิดแอปใหม่'
    )

  const agent = new ToolLoopAgent({
    // กันชื่อโมเดลแปลกปลอม ถ้าไม่อยู่ในรายการให้ใช้ตัวแรก
    model: llm(MODELS.includes(model) ? model : MODELS[0]),
    instructions,
    stopWhen: isStepCount(30),
    tools: {
      list_table_name: wrap(listTool, { downloadsDir }),
      get_table_schema: wrap(schemaTool, { downloadsDir }),
      query_data: wrap(queryTool, { downloadsDir }),
      export_excel: wrap(excelTool, { downloadsDir }),
      rest_api: wrap(apiTool, { downloadsDir }),
      memory: wrap(memoryTool, { downloadsDir }),
      render_chart: wrap(chartTool, { downloadsDir })
    },
    toolApproval: ({ toolCall }) =>
      risky(toolCall.toolName, toolCall.input) ? 'user-approval' : undefined
  })

  // ส่งบทสนทนาเดิมเป็นข้อความธรรมดา (ยังไม่ได้แนบ tool call ของเทิร์นก่อน เหมือนฝั่ง sdk)
  const convo = messages.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }))

  let step = null
  let lastTool = ''
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
        // tool ที่ไม่ได้รับ sql (หาชื่อตาราง/ดูคอลัมน์/เขียนไฟล์) ต้องมีป้ายบอกว่าทำอะไรกับอะไร
        // ไม่งั้นช่องบนจอขึ้นแค่ชื่อ tool ลอยๆ
        const label = sql ?? `${part.toolName}: ${Object.values(part.input ?? {}).join(' ')}`
        onStep?.({ sql: label })
        step = { sql: label, result: null }
        lastTool = part.toolName
        if (isTemp(sql) && !script.includes(sql)) script.push(sql)
      }
      if (part.type === 'tool-result') {
        step = { sql: step?.sql ?? '', result: part.output }
        if (!EXPLORE.includes(lastTool) && !/^\s*(show|desc|describe|explain)\b/i.test(step.sql))
          dataStep = step
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
