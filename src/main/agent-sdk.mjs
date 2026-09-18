// spike: ลองย้าย agent loop ไปใช้ @openai/agents ดูว่าได้อะไร/เสียอะไร
// ยังไม่ผูกกับ electron เพื่อให้รันเทียบด้วย node ตรงๆ ได้
import { OpenAI } from 'openai'
import {
  Agent,
  Runner,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled
} from '@openai/agents'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { openSql } from './tools/sql.mjs'

// spike รันด้วย node ตรงๆ เลยอ่านไฟล์เอา ไม่ใช้ ?raw ของ vite
const SYSTEM_PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8')

setDefaultOpenAIClient(
  new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.MAIN_VITE_OPENROUTER_API_KEY
  })
)
setOpenAIAPI('chat_completions') // OpenRouter ไม่มี Responses API
setTracingDisabled(true) // ไม่งั้น SDK ส่ง trace ไป platform ของ OpenAI

const db = openSql({
  host: process.env.MAIN_VITE_DB_HOST,
  port: Number(process.env.MAIN_VITE_DB_PORT || 3306),
  user: process.env.MAIN_VITE_DB_USER,
  password: process.env.MAIN_VITE_DB_PASSWORD,
  database: process.env.MAIN_VITE_DB_NAME
})

const sqlTool = tool({
  name: 'sql',
  description: 'รัน SQL กับฐานข้อมูล HOSxP ทีละคำสั่ง คืน columns/rows/rowCount',
  parameters: z.object({ sql: z.string() }),
  // จุดขายของ SDK: หยุด loop มาถามผู้ใช้ก่อน แล้ว resume ได้
  needsApproval: async (_ctx, { sql }) => /^\s*select\s+\*/i.test(sql) && !/\blimit\b/i.test(sql),
  execute: async ({ sql }) => JSON.stringify(await db.query(sql))
})

export const agent = new Agent({
  name: 'HOSxP SQL',
  instructions: SYSTEM_PROMPT,
  model: process.env.SPIKE_MODEL || 'qwen/qwen3.7-flash',
  // พารามิเตอร์เฉพาะ OpenRouter ส่งผ่าน providerData (SDK spread ลง request body ให้)
  modelSettings: { maxTokens: 8192, providerData: { reasoning: { enabled: true } } },
  tools: [sqlTool]
})

export const runner = new Runner()
export const closeSpike = () => db.close()
