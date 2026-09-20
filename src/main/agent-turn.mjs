import { stoppedAnswer } from './tool-run.mjs'

// One owner for execution, cancellation and completion, including prompt loading.
export function createAgentTurns({
  buildSystem,
  run,
  enrich,
  finalize = async (answer) => answer,
  downloadsDir
}) {
  let active = null
  return {
    stop(turnId) {
      if (active?.turnId === turnId) active.controller.abort()
    },
    async send({ turnId, conversationId, messages, model }, emit = () => {}) {
      if (active) throw new Error('มีงานกำลังทำอยู่ กรุณารอหรือกดหยุดก่อน')
      if (!turnId || !conversationId) throw new Error('Missing turn or conversation identity')
      const turn = { turnId, conversationId, controller: new AbortController() }
      active = turn
      const signal = turn.controller.signal
      const notify = (type) => (value) => {
        if (active === turn && !signal.aborted) emit(type, { turnId, conversationId, value })
      }
      let answer
      try {
        const instructions = await buildSystem()
        signal.throwIfAborted()
        answer = await run(messages, {
          model,
          instructions,
          downloadsDir,
          signal,
          onStep: notify('step'),
          onDelta: notify('delta'),
          onJev: notify('jev')
        })
        if (answer.status === 'stopped') return answer
        signal.throwIfAborted()
        answer = await finalize(answer, messages, { signal, instructions, onJev: notify('jev') })
        if (answer.status === 'stopped') return answer
        signal.throwIfAborted()
        const enriched = await enrich(answer, signal)
        signal.throwIfAborted()
        return enriched
      } catch (error) {
        if (!signal.aborted) throw error
        return answer?.status === 'stopped' ? answer : stoppedAnswer(answer)
      } finally {
        if (active === turn) active = null
      }
    }
  }
}
