// agent ของแอป — Vercel AI SDK ยิงผ่าน LiteLLM proxy อย่างเดียว ไม่ต่อ OpenRouter ตรง
// (proxy คุมคีย์ โควตา และสิทธิ์โมเดลรายคนให้ แอปถือแค่ virtual key ของตัวเอง)
import { app } from 'electron'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ToolLoopAgent, tool, jsonSchema, isStepCount, generateText, pruneMessages } from 'ai'
import { createConversationMemory, toModelMessages } from './conversation-memory.mjs'
import { openSql, sqlTool } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { chartTool } from './tools/chart.mjs'
import { webTool } from './tools/web.mjs'
import { statsTool } from './tools/stats.mjs'

// ชื่อ tool ที่โมเดลเห็น มาจาก t.name ของแต่ละไฟล์ — เพิ่ม tool ใหม่แก้ที่เดียว
const TOOLS = [sqlTool, excelTool, apiTool, memoryTool, chartTool, webTool, statsTool]
import { fit } from './fit.mjs'
import { collectToolRun } from './tool-run.mjs'
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

// ฐาน HOSxP ตัวเดียวของแอป ส่งให้ทุก tool ผ่าน ctx.db — โมเดลไม่เห็นรหัสผ่าน (ต่อจริงตอน query แรก)
export const hospitalDb = openSql({
  host: env('DB_HOST', 'localhost'),
  port: Number(env('DB_PORT', 3306)),
  user: env('DB_USER'),
  password: env('DB_PASSWORD'),
  database: env('DB_NAME')
})

// ความจำของห้องแชท (ข้อความล่าสุด + สรุป + ความจำกลาง) — ย่อสรุปด้วยโมเดลตัวแรกของ LLM_MODELS
export const conversationMemory = createConversationMemory({
  store,
  prompt: SYSTEM_PROMPT,
  generate: async ({ instructions, prompt }) =>
    (await generateText({ model: llm(MODELS[0]), instructions, prompt })).text
})

// งานยาวที่ tool ส่งผลก้อนใหญ่หลายรอบ — เกินงบค่อยตัด reasoning/tool call เก่า เหลือ 3 ข้อความท้าย
// ต่ำกว่างบไม่ตัด เพราะ tool call เทิร์นก่อนช่วยให้โมเดลไม่ SHOW COLUMNS ซ้ำ (ดู toModelMessages)
const PRUNE_AT = 60_000 // token โดยประมาณ (ความยาว JSON / 4)
const prepareStep = ({ messages }) =>
  JSON.stringify(messages).length / 4 > PRUNE_AT
    ? {
        messages: pruneMessages({
          messages,
          reasoning: 'before-last-message',
          toolCalls: 'before-last-3-messages',
          emptyMessages: 'remove'
        })
      }
    : undefined

export const closeAgent = () => hospitalDb.close()

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
  { instructions, model, onStep, onDelta, signal, allowTools = true } = {}
) {
  if (!BASE_URL)
    throw new Error(
      'ยังไม่ได้ตั้ง LLM_BASE_URL ใน .env — ใส่ base url ของ LiteLLM proxy เช่น http://localhost:4000/v1 แล้วเปิดแอปใหม่'
    )

  const convo = toModelMessages(messages)
  // โมเดลที่ผู้ใช้เลือกบนจอ — ค่าที่ไม่รู้จัก (เช่นค่า AUTO เก่าใน localStorage) ใช้ตัวแรก
  const picked = MODELS.includes(model) ? model : MODELS[0]
  const agent = new ToolLoopAgent({
    model: llm(picked),
    instructions,
    stopWhen: isStepCount(30),
    prepareStep,
    // ctx = dependency ของ tool: ฐาน HOSxP, PGlite ของแอป, โฟลเดอร์ Downloads
    tools: allowTools
      ? Object.fromEntries(
          TOOLS.map((t) => [
            t.name,
            wrap(t, { db: hospitalDb, store, downloadsDir: app.getPath('downloads') })
          ])
        )
      : {}
  })

  return collectToolRun(() => agent.stream({ messages: convo, abortSignal: signal }), {
    model: picked,
    signal,
    onStep,
    onDelta
  })
}

export async function reviseAgentAnswer(messages, answer, reason, { instructions, signal }) {
  const correction = {
    role: 'user',
    content: `Review correction: ${reason} Rewrite the final answer in the user's language using only the successful tool evidence already present. Distinguish unique people from row counts. Do not invent data. If evidence is insufficient, say so. Do not execute tools.`
  }
  const revised = await askAgentAi([...messages, answer, correction], {
    instructions,
    model: answer.model,
    signal,
    allowTools: false
  })
  return {
    ...answer,
    content: revised.content,
    ...(revised.status ? { status: revised.status } : {}),
    modelMessages: [...(answer.modelMessages ?? []), correction, ...(revised.modelMessages ?? [])]
  }
}
