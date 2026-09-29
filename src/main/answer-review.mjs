import { selectDisplay } from './display-result.mjs'

// Display result เลือกผลและเทียบ COUNT เอง — ไฟล์นี้เหลือแค่วงจร ตรวจ → แก้ → ตรวจซ้ำ
export async function reviewAnswer(answer, _messages, signal) {
  signal?.throwIfAborted()
  const { step, mismatch } = selectDisplay(answer.toolSteps, answer.content ?? '')
  return {
    status: mismatch ? 'revise' : 'supported',
    changed: (step?.toolCallId ?? null) !== (answer.step?.toolCallId ?? null),
    reason: 'The numeric answer does not contain the selected COUNT result.',
    answer: { ...answer, step }
  }
}

function unverified(answer, checks) {
  const content = `⚠ ตรวจคำตอบแล้วยังยืนยันความสอดคล้องกับผลลัพธ์ไม่ได้\n\n${answer.content}`
  return {
    ...answer,
    content,
    verification: { status: 'failed', checks },
    modelMessages: [...(answer.modelMessages ?? []), { role: 'assistant', content }]
  }
}

// At most one repair and two reviews. Repairs cannot execute tools again.
export async function finalizeAnswer(
  answer,
  messages,
  { signal, review = reviewAnswer, revise, onGuardrail } = {}
) {
  if (answer.status === 'stopped') return answer
  onGuardrail?.('guardrail: กำลังตรวจคำตอบและผลลัพธ์')
  const first = await review(answer, messages, signal)
  signal?.throwIfAborted()
  let current = first.answer
  if (first.status === 'supported' && !first.changed)
    return { ...current, verification: { status: 'guardrail-passed', checks: 1 } }
  if (first.status === 'revise') {
    onGuardrail?.('guardrail: กำลังแก้คำตอบให้ตรงกับผลลัพธ์')
    try {
      current = await revise(current, first.reason, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      return unverified(current, 1)
    }
    if (current.status === 'stopped') return current
  }
  onGuardrail?.('guardrail: กำลังตรวจคำตอบซ้ำ')
  const second = await review(current, messages, signal)
  signal?.throwIfAborted()
  if (second.status !== 'supported') return unverified(second.answer, 2)
  return { ...second.answer, verification: { status: 'guardrail-passed', checks: 2 } }
}
