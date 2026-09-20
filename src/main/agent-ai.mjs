// agent ของแอป — Vercel AI SDK ยิงผ่าน LiteLLM proxy อย่างเดียว ไม่ต่อ OpenRouter ตรง
// (proxy คุมคีย์ โควตา และสิทธิ์โมเดลรายคนให้ แอปถือแค่ virtual key ของตัวเอง)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { askJev, HOSXP } from './jev.mjs'
import { ToolLoopAgent, tool, jsonSchema, isStepCount } from 'ai'
import { db, sqlTool } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { chartTool } from './tools/chart.mjs'
import { webTool } from './tools/web.mjs'

// ชื่อ tool ที่โมเดลเห็น มาจาก t.name ของแต่ละไฟล์ — เพิ่ม tool ใหม่แก้ที่เดียว
const TOOLS = [sqlTool, excelTool, apiTool, memoryTool, chartTool, webTool]
import { fit } from './fit.mjs'
import { collectToolRun } from './tool-run.mjs'
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

// เลือกโมเดลตามความยากของงาน — glm แพงสุด/เก่งสุด, deepseek ถูกสุด (วัดความรู้ HOSxP ได้ 13/15
// ตอน glm กับ qwen ได้ 15/15) จับคู่จากชื่อ ถ้า .env เปลี่ยนรุ่นก็ยังหาเจอ
// ไล่ตามลำดับในลิสต์ ตัวไหนมีใน LLM_MODELS ก่อนก็ใช้ตัวนั้น — ling ยังไม่ได้ขึ้น LiteLLM
// พอเพิ่มเข้าไปแล้วมันจะสลับมาใช้เองโดยไม่ต้องแก้โค้ด ระหว่างนี้ตกไปใช้ตัวสำรอง
const TIER = {
  hard: [/glm/i],
  medium: [/inclusionai\/ling/i, /qwen/i],
  easy: [/inclusionai\/ling/i, /deepseek/i]
}
const pickTier = (level) => {
  for (const re of TIER[level] ?? []) {
    const found = MODELS.find((m) => re.test(m))
    if (found) return found
  }
  return MODELS[0]
}
const LEVEL_TH = { hard: 'ยาก', medium: 'ปานกลาง', easy: 'ง่าย' }
// ชื่อโมเดลบนจอเอาแค่ท้ายสแลช ผู้ใช้ไม่ต้องรู้ชื่อผู้ให้บริการ
const shortName = (m) => m.split('/').pop()
const LEVEL_CRITERIA = {
  hard: 'The answer needs at least one of: three or more tables joined; looking a code up in a registry table before it can be filtered on; finding people for whom a record is ABSENT (never vaccinated, never screened, did not return); or arithmetic on dates and ages such as an age window at a given date. Clinical indicators defined by a ministry or funder are hard',
  medium:
    'The answer needs one or two tables plus a WHERE and a GROUP BY, or a distinct count over a date range. It may take one lookup to confirm which table holds the data, but no registry decoding and no absence check',
  easy: 'The answer is a single count, sum or short listing straight out of one obvious table with at most a simple filter. Also easy: a greeting, chitchat, or a follow-up on the previous answer such as make it a chart, export to excel, show more rows, sort differently'
}

// วัดกับคำถามจริง 14 ข้อจากงานหน้างาน ถูก 14/14 สองรอบติด — npm run bench:route
async function chooseModel(ask, signal, onJev) {
  if (!ask?.trim()) return MODELS[0]
  const answers = await askJev(
    { hosxp: HOSXP, user_request: ask },
    {
      level: {
        type: 'choice',
        instructions:
          'How much SQL work does this request take on a hospital database? Judge the shape of the query needed, not how unfamiliar the wording sounds',
        criteria: LEVEL_CRITERIA
      }
    },
    signal
  )
  // jev ฟันธงมาให้ในฟิลด์ choice อยู่แล้ว ไม่ต้องไปหา argmax จาก probabilities เอง
  const { choice, confidence } = answers?.level ?? {}
  // ตัดสินไม่ได้ = ใช้ตัวเก่งสุด ถูกกว่าเดาเป็นตัวถูกแล้วตอบผิด
  if (!choice) return MODELS[0]
  const picked = pickTier(choice)
  console.log(`[jev] งาน${choice} (${Number(confidence ?? 0).toFixed(2)}) → ${picked}`)
  onJev?.(`jev: งาน${LEVEL_TH[choice] ?? choice} → ${shortName(picked)}`)
  return picked
}

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
  { instructions, model, downloadsDir, onStep, onDelta, onJev, signal, allowTools = true } = {}
) {
  if (!BASE_URL)
    throw new Error(
      'ยังไม่ได้ตั้ง LLM_BASE_URL ใน .env — ใส่ base url ของ LiteLLM proxy เช่น http://localhost:4000/v1 แล้วเปิดแอปใหม่'
    )

  const convo = toModelMessages(messages)
  const ask = lastAsk(convo)
  // ผู้ใช้เลือกเองได้ ถ้าไม่เลือก (AUTO) ให้ jev ดูคำถามแล้วจับคู่โมเดลตามความยาก
  const picked = MODELS.includes(model) ? model : await chooseModel(ask, signal, onJev)

  signal?.throwIfAborted()
  const agent = new ToolLoopAgent({
    model: llm(picked),
    instructions,
    stopWhen: isStepCount(30),
    // ask = คำถามผู้ใช้เทิร์นนี้ ส่งให้ tool ใช้ได้ (web_search เอาไปให้ jev คัดผลค้น)
    tools: allowTools
      ? Object.fromEntries(TOOLS.map((t) => [t.name, wrap(t, { downloadsDir, ask })]))
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
