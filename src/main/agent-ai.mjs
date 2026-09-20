// agent ของแอป — Vercel AI SDK ยิงผ่าน LiteLLM proxy อย่างเดียว ไม่ต่อ OpenRouter ตรง
// (proxy คุมคีย์ โควตา และสิทธิ์โมเดลรายคนให้ แอปถือแค่ virtual key ของตัวเอง)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ToolLoopAgent, tool, jsonSchema, isStepCount } from 'ai'
import { db, sqlTool, isTemp } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { chartTool } from './tools/chart.mjs'
import { webTool } from './tools/web.mjs'

// ชื่อ tool ที่โมเดลเห็น มาจาก t.name ของแต่ละไฟล์ — เพิ่ม tool ใหม่แก้ที่เดียว
const TOOLS = [sqlTool, excelTool, apiTool, memoryTool, chartTool, webTool]
import { fit } from './fit.mjs'
import { toModelMessages } from './history.mjs'
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

// ข้อความล่าสุดของผู้ใช้ — เทิร์นเก่าถูก replay มาด้วย เลยต้องไล่จากท้าย
const lastAsk = (msgs) => {
  const c = [...msgs].reverse().find((m) => m.role === 'user')?.content
  if (typeof c === 'string') return c
  return (c ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
}

// JSON schema เดิมใช้ได้เลยผ่าน jsonSchema() ไม่ต้องเขียน zod ใหม่
const wrap = (t, ctx) =>
  tool({
    description: t.description,
    inputSchema: jsonSchema(t.parameters),
    execute: async (input, { abortSignal }) => t.run(input, abortSignal, ctx),
    toModelOutput: ({ output }) => ({ type: 'json', value: fit(output) })
  })

export async function askAgentAi(
  messages,
  { instructions, model, downloadsDir, onStep, onDelta, signal } = {}
) {
  if (!BASE_URL)
    throw new Error(
      'ยังไม่ได้ตั้ง LLM_BASE_URL ใน .env — ใส่ base url ของ LiteLLM proxy เช่น http://localhost:4000/v1 แล้วเปิดแอปใหม่'
    )

  const convo = toModelMessages(messages)

  const agent = new ToolLoopAgent({
    // กันชื่อโมเดลแปลกปลอม ถ้าไม่อยู่ในรายการให้ใช้ตัวแรก
    model: llm(MODELS.includes(model) ? model : MODELS[0]),
    instructions,
    stopWhen: isStepCount(30),
    // ask = คำถามผู้ใช้เทิร์นนี้ ส่งให้ tool ใช้ได้ (web_search เอาไปให้ jev คัดผลค้น)
    tools: Object.fromEntries(
      TOOLS.map((t) => [t.name, wrap(t, { downloadsDir, ask: lastAsk(convo) })])
    )
  })

  // ทุกอย่างที่งอกหลังจุดนี้คือของเทิร์นนี้ เก็บไว้ให้เทิร์นหน้า replay ต่อ
  const baseline = convo.length

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
        // tool ที่ไม่ได้รับ sql (memory/rest_api) ต้องมีป้ายบอกว่าทำอะไรกับอะไร
        // ไม่งั้นช่องบนจอขึ้นแค่ชื่อ tool ลอยๆ
        const label = sql ?? `${part.toolName}: ${Object.values(part.input ?? {}).join(' ')}`
        onStep?.({ sql: label })
        step = { sql: label, result: null }
        // จองที่ไว้ตามลำดับที่เรียก แต่ยังไม่รู้ว่าผ่านไหม ต้องรอ tool-result มาติ๊ก ok
        if (isTemp(sql) && !script.some((s) => s.sql === sql))
          script.push({ id: part.toolCallId, sql, ok: false })
      }
      if (part.type === 'tool-result') {
        step = { sql: step?.sql ?? '', result: part.output }
        if (!/^\s*(show|desc|describe|explain)\b/i.test(step.sql)) dataStep = step
        // คำสั่งที่ถูกปฏิเสธ (เช่น CREATE TABLE ที่ไม่ใช่ TEMPORARY) ต้องไม่หลุดเข้าสคริปต์
        // ที่ผู้ใช้ก๊อปไปรันเอง ไม่งั้นเขาไปสร้างตารางจริงในฐานโดยไม่ตั้งใจ
        const entry = script.find((s) => s.id === part.toolCallId)
        if (entry) entry.ok = !part.output?.error
      }
      // tool พังหรือถูกปฏิเสธไม่ได้มาเป็น tool-result — ไม่ดักไว้ result จะค้างเป็น null แล้วหน้าจอโชว์ error ว่างๆ
      if (part.type === 'tool-error')
        step = { sql: step?.sql ?? '', result: { error: String(part.error) } }
    }
    return result
  }

  const result = await run(convo)

  // ถ้ามี query จริงให้โชว์อันนั้น ไม่ใช่ DESCRIBE ที่บังเอิญเป็นคำสั่งสุดท้าย
  const final = dataStep ?? step
  const ran = script.filter((s) => s.ok).map((s) => s.sql)
  return {
    role: 'assistant',
    content: await result.text,
    // ผ่าน JSON รอบหนึ่ง เพราะของนี้ต้องข้าม IPC แล้วลง jsonb — ให้พังตรงนี้ดีกว่าไปพังหลังเปิดแอปใหม่
    modelMessages: JSON.parse(
      JSON.stringify([...convo.slice(baseline), ...(await result.responseMessages)])
    ),
    step: final && ran.length ? { ...final, sql: ran.join(';\n\n') } : final
  }
}
