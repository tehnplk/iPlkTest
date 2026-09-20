import { fit } from './fit.mjs'

const metadata = /^\s*(show|desc|describe|explain)\b/i
const temporary = (sql) => /\btmp_/i.test(sql ?? '')
const label = (call) =>
  call.input?.sql ?? `${call.toolName}: ${Object.values(call.input ?? {}).join(' ')}`

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
        onStep?.({ sql: label(part) })
      }
      if ((part.type === 'tool-result' && !part.preliminary) || part.type === 'tool-error') {
        const entry = calls.get(part.toolCallId)
        if (!entry || entry.done) continue
        entry.done = true
        entry.failed = part.type === 'tool-error'
        entry.output = entry.failed ? { error: String(part.error) } : part.output
        completed.push(entry)
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
    result: output
  }))
  // Retain each temporary query's own successful prerequisites for later display selection.
  const orderedCalls = [...calls.values()]
  for (const step of steps) {
    if (!temporary(step.sql)) continue
    const position = orderedCalls.findIndex((entry) => entry.call.toolCallId === step.toolCallId)
    step.sqlScript = orderedCalls
      .slice(0, position + 1)
      .filter(
        (entry) =>
          entry.done && !entry.failed && !entry.output?.error && temporary(entry.call.input?.sql)
      )
      .map((entry) => entry.call.input.sql)
      .join(';\n\n')
  }
  const display = steps
    .filter(
      (step) =>
        !step.result?.error &&
        !metadata.test(step.sql) &&
        (step.result?.chart ||
          step.result?.file ||
          (Array.isArray(step.result?.columns) &&
            step.result.columns.length > 0 &&
            Array.isArray(step.result?.rows)))
    )
    .at(-1)
  const selected = display ?? steps.at(-1) ?? null
  const script = [...calls.values()]
    .filter(
      (entry) =>
        entry.done && !entry.failed && !entry.output?.error && temporary(entry.call.input?.sql)
    )
    .map((entry) => entry.call.input.sql)
  const step =
    selected && script.length && temporary(selected.sql)
      ? { ...selected, querySql: selected.sql, sql: script.join(';\n\n') }
      : selected

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
