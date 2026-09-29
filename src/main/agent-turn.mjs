import { stoppedAnswer } from './tool-run.mjs'

// One owner for an agent turn: load context → run → review → enrich → save.
// The renderer sends only the latest text; history, summary and memory come from buildContext,
// and the finished reply (answered, stopped or failed) is persisted here, not by the renderer.
export function createAgentTurns({
  buildContext,
  run,
  enrich,
  finalize = async (answer) => answer,
  save = async () => {}
}) {
  let active = null

  // A person lookup failure must not discard a finished answer; it just stays unenriched.
  const tryEnrich = async (answer, signal) => {
    try {
      return await enrich(answer, signal)
    } catch (error) {
      if (signal.aborted) throw error
      console.error('person enrichment failed:', error)
      return answer
    }
  }

  const execute = async ({ conversationId, text, model }, signal, notify) => {
    let answer
    try {
      const { instructions, messages } = await buildContext({ conversationId, text })
      signal.throwIfAborted()
      answer = await run(messages, {
        model,
        instructions,
        signal,
        onStep: notify('step'),
        onDelta: notify('delta')
      })
      if (answer.status === 'stopped') return answer
      signal.throwIfAborted()
      answer = await finalize(answer, messages, {
        signal,
        instructions,
        onGuardrail: notify('guardrail')
      })
      if (answer.status === 'stopped') return answer
      signal.throwIfAborted()
      const enriched = await tryEnrich(answer, signal)
      signal.throwIfAborted()
      return enriched
    } catch (error) {
      if (signal.aborted) return answer?.status === 'stopped' ? answer : stoppedAnswer(answer)
      return {
        role: 'assistant',
        status: 'error',
        content: `เรียก agent ไม่สำเร็จ: ${error.message}`
      }
    }
  }

  return {
    stop(turnId) {
      if (active?.turnId === turnId) active.controller.abort()
    },
    async send({ turnId, conversationId, text, model }, emit = () => {}) {
      if (active) throw new Error('มีงานกำลังทำอยู่ กรุณารอหรือกดหยุดก่อน')
      if (!turnId || !conversationId) throw new Error('Missing turn or conversation identity')
      const turn = { turnId, conversationId, controller: new AbortController() }
      active = turn
      const signal = turn.controller.signal
      const notify = (type) => (value) => {
        if (active === turn && !signal.aborted) emit(type, { turnId, conversationId, value })
      }
      try {
        const reply = await execute({ conversationId, text, model }, signal, notify)
        try {
          await save(conversationId, [{ role: 'user', content: text }, reply], text.slice(0, 40))
          return reply
        } catch (error) {
          return { ...reply, saveError: error.message }
        }
      } finally {
        if (active === turn) active = null
      }
    }
  }
}
