import { app } from 'electron'
import OpenAI from 'openai'
import { db, sqlTool } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'
import { toHistory } from './history.mjs'
import { store } from './store.mjs'
import SYSTEM_PROMPT from './prompt.md?raw'

// เพิ่ม tool ใหม่ = เขียนไฟล์ใน tools/ แล้วมาต่อท้ายรายการนี้
const TOOL_LIST = [sqlTool, excelTool, apiTool, memoryTool]
const TOOLS = TOOL_LIST.map(({ name, description, parameters }) => ({
  type: 'function',
  function: { name, description, parameters }
}))
const runTool = (name, args, signal) =>
  TOOL_LIST.find((t) => t.name === name).run(args, signal, {
    downloadsDir: app.getPath('downloads')
  })

// รายชื่อที่ให้เลือกในหน้าจอ ตัวแรกคือค่าเริ่มต้น
export const MODELS = [
  'qwen/qwen3.7-flash',
  'z-ai/glm-5.3-flash',
  'upstage/solar-pro4',
  'deepseek/deepseek-v4.1-flash'
]
// reasoning กินโควตานี้ก่อน ตั้งต่ำไปจะได้แต่ความคิดแล้วไม่เหลือ token ให้ตอบ
// (OpenRouter กันเครดิตล่วงหน้าตามค่านี้ด้วย เครดิตน้อยแล้วเจอ 402 ให้ลดลง)
const MAX_TOKENS = 8192
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  // ไม่มีคีย์ก็ยังเปิดแอปได้ — จะไปเด้ง 401 ตอนคุยแทน (SDK โยน error ทันทีถ้า apiKey ว่าง)
  apiKey:
    import.meta.env.MAIN_VITE_OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    'missing-api-key'
})

// ponytail: โมเดลชอบพิมพ์ตารางซ้ำทั้งที่ UI โชว์ให้แล้ว สั่งใน prompt อย่างเดียวไม่พอ เลยตัดทิ้งตรงนี้ด้วย
const stripTable = (text) =>
  text
    .replace(/^\|.*\|[ \t]*$\n?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

async function chat(messages, model, onStep, onDelta, signal) {
  const history = toHistory(messages)
  const saved = await (await store()).memories()
  const system = saved.length
    ? `${SYSTEM_PROMPT}

# ความจำกลาง (ผู้ใช้เคยสั่งให้จำไว้ ใช้ได้เลยไม่ต้องถามซ้ำ)
${saved.map((m) => `- ${m}`).join('\n')}`
    : SYSTEM_PROMPT
  const convo = [{ role: 'system', content: system }, ...history]
  let step = null

  // ponytail: ไม่จำกัดจำนวนรอบตามที่ผู้ใช้สั่ง — โมเดลวนไม่จบได้และค่า token โตทุกรอบ
  // ถ้าเจอวนไม่หยุด: ปิดแอป แล้วใส่ cap กลับที่ลูปนี้
  for (;;) {
    try {
      // stream ให้ UI เห็นคำตอบไหลออกมาระหว่างที่โมเดลยังพิมพ์ไม่จบ
      // helper ของ SDK ประกอบ delta กลับเป็น message ก้อนเดียวให้เอง (tool_calls/reasoning_details ครบ)
      const stream = openai.chat.completions.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          reasoning: { enabled: true },
          tools: TOOLS,
          messages: convo
        },
        { signal }
      )
      stream.on('content', (delta) => onDelta?.(delta))
      const res = await stream.finalChatCompletion()
      const msg = res.choices[0].message
      // เก็บแค่ step สุดท้าย — UI โชว์ SQL ที่ใช้จริงอันเดียวพอ
      if (!msg.tool_calls?.length) return { msg, step }
      convo.push(msg)
      // โมเดลขอหลาย query ในรอบเดียวได้ รันพร้อมกันเลย (ตัวที่แตะ tmp_ ถูกบังคับให้เรียงคิวใน sql.mjs)
      const done = await Promise.all(
        msg.tool_calls.map(async (call) => {
          const args = JSON.parse(call.function.arguments || '{}')
          // tool ที่ไม่ใช่ sql ก็ต้องมีป้ายบอกว่าทำอะไร ไม่งั้นช่องบนจอว่างเปล่า
          const stmt =
            args.sql ??
            (args.url
              ? `${(args.method || 'GET').toUpperCase()} ${args.url}`
              : `${call.function.name}: ${Object.values(args).join(' ')}`)
          onStep?.({ sql: stmt })
          return { call, stmt, result: await runTool(call.function.name, args, signal) }
        })
      )
      for (const d of done) {
        step = { sql: d.stmt, result: d.result }
        convo.push({ role: 'tool', tool_call_id: d.call.id, content: JSON.stringify(d.result) })
      }
    } catch (err) {
      // กดหยุดระหว่างรอ API หรือระหว่าง query — คืนเท่าที่ได้มาแล้ว
      if (signal?.aborted) return { msg: { role: 'assistant', content: '⏹ หยุดโดยผู้ใช้' }, step }
      throw err
    }
  }
}

// จุดเดียวที่ main เรียกใช้: ส่งบทสนทนาเข้าไป ได้ข้อความตอบกลับพร้อม step ที่รันไป
export async function askAgent(messages, { model, onStep, onDelta, signal } = {}) {
  // กันชื่อโมเดลแปลกปลอม ถ้าไม่อยู่ในรายการให้ใช้ตัวแรก
  const { msg, step } = await chat(
    messages,
    MODELS.includes(model) ? model : MODELS[0],
    onStep,
    onDelta,
    signal
  )
  const { role, content, reasoning_details } = msg
  const clean = step?.result?.rows?.length && content ? stripTable(content) : content
  // ห้ามเอา reasoning มาโชว์แทนคำตอบ มันคือความคิดดิบ ๆ ที่ยังไม่เรียบเรียง
  return {
    role,
    content: clean || '⚠ token หมดไปกับการคิดจนยังไม่ได้ตอบ — กด "ทำต่อ" หรือถามให้แคบลง',
    reasoning_details,
    step
  }
}

export const closeAgent = () => db.close()
