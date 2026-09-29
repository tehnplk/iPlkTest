import { fit } from './fit.mjs'
import { selectDisplay } from './display-result.mjs'

// ค่าที่เป็น object (เช่น headers ของ api) ต้องเป็น JSON ไม่งั้นขึ้น [object Object]
const label = (call) =>
  call.input?.sql ??
  `${call.toolName}: ${Object.values(call.input ?? {})
    .map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v))
    .join(' ')}`

export const stoppedAnswer = (answer = {}) => ({
  ...answer,
  role: 'assistant',
  status: 'stopped',
  content: `⏹ หยุดแล้ว${answer.content ? `\n\n${answer.content}` : ''}`
})

// Own correlation, display selection and cancellation replay at the stream seam.
export async function collectToolRun(stream, { model, signal, onStep, onDelta } = {}) {
  const calls = new Map()
  const events = []
  const completed = []
  let text = ''
  let result
  let stopped = false
  try {
    signal?.throwIfAborted()
    result = await stream()
    for await (const part of result.fullStream) {
      if (part.type === 'abort') {
        stopped = true
        break
      }
      if (part.type === 'error') throw part.error
      if (part.type === 'text-delta') {
        text += part.text ?? ''
        const last = events.at(-1)
        if (last?.type === 'text') last.text += part.text ?? ''
        else events.push({ type: 'text', text: part.text ?? '' })
        onDelta?.(part.text ?? '')
      }
      if (part.type === 'tool-call') {
        calls.set(part.toolCallId, { call: part })
        events.push({ type: 'call', id: part.toolCallId })
        onStep?.({ id: part.toolCallId, tool: part.toolName, sql: label(part) })
      }
      if ((part.type === 'tool-result' && !part.preliminary) || part.type === 'tool-error') {
        const entry = calls.get(part.toolCallId)
        if (!entry || entry.done) continue
        entry.done = true
        entry.failed = part.type === 'tool-error'
        entry.output = entry.failed ? { error: String(part.error) } : part.output
        completed.push(entry)
        // ผลของ call เดิม — จอเปลี่ยนสถานะบรรทัดนั้นจาก "กำลังทำ" เป็นผลลัพธ์
        onStep?.({
          id: part.toolCallId,
          tool: entry.call.toolName,
          sql: label(entry.call),
          result: entry.output
        })
      }
    }
    stopped ||= Boolean(signal?.aborted)
  } catch (error) {
    if (!signal?.aborted) throw error
    stopped = true
  }

  const steps = completed.map(({ call, output }) => ({
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    sql: label(call),
    input: call.input,
    result: output
  }))
  const { step } = selectDisplay(steps)

  // On stop, reconstruct only completed pairs. Never replay an orphan call.
  const replay = () =>
    events.flatMap((event) => {
      if (event.type === 'text') return [{ role: 'assistant', content: event.text }]
      const entry = calls.get(event.id)
      if (!entry?.done) return []
      const { toolCallId, toolName, input } = entry.call
      return [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId,
              toolName,
              input,
              providerOptions: entry.call.providerMetadata
            }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId,
              toolName,
              output: entry.failed
                ? { type: 'error-text', value: entry.output.error }
                : { type: 'json', value: fit(entry.output) }
            }
          ]
        }
      ]
    })
  let modelMessages
  try {
    modelMessages = stopped ? replay() : await result.responseMessages
    if (!stopped) text = (await result.text)?.trim() || text
    stopped ||= Boolean(signal?.aborted)
  } catch (error) {
    if (!signal?.aborted) throw error
    stopped = true
  }
  if (stopped) modelMessages = replay()
  const answer = {
    role: 'assistant',
    model,
    content: text,
    step,
    toolSteps: steps,
    modelMessages: JSON.parse(JSON.stringify(modelMessages))
  }
  return stopped
    ? stoppedAnswer(answer)
    : {
        ...answer,
        content:
          text || '⚠ โมเดลไม่ได้ตอบข้อความกลับมา ลองถามใหม่ หรือเลือกโมเดลอื่นจากกล่องมุมขวาบน'
      }
}
