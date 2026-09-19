// agent เวอร์ชัน Vercel AI SDK — ใช้ tool ชุดเดียวกับอีกสอง engine
// ต่าง: OpenRouter เป็น provider ทางการ และ approval เป็นฟีเจอร์ในตัว (toolApproval)
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { ToolLoopAgent, tool, jsonSchema, isStepCount } from 'ai'
import { sqlTool, isTemp } from './tools/sql.mjs'
import { excelTool } from './tools/excel.mjs'
import { apiTool } from './tools/api.mjs'
import { memoryTool } from './tools/memory.mjs'

const env = (key, fallback = '') => import.meta.env?.[key] ?? process.env[key] ?? fallback

const openrouter = createOpenRouter({
  apiKey: env('MAIN_VITE_OPENROUTER_API_KEY', 'missing-api-key')
})

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
    model: openrouter(model),
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
      if (part.type === 'text-delta') onDelta?.(part.text ?? '')
      if (part.type === 'tool-call') {
        const sql = part.input?.sql
        onStep?.({ sql: sql ?? `${part.toolName}: ${Object.values(part.input ?? {}).join(' ')}` })
        step = { sql: sql ?? part.toolName, result: null }
        if (isTemp(sql) && !script.includes(sql)) script.push(sql)
      }
      if (part.type === 'tool-result') {
        step = { sql: step?.sql ?? '', result: part.output }
        if (!/^\s*(show|desc|describe|explain)/i.test(step.sql)) dataStep = step
      }
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

  return {
    role: 'assistant',
    content: await result.text,
    step: step && script.length ? { ...step, sql: script.join(';\n\n') } : step
  }
}
