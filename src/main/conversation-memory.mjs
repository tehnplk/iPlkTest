// Conversation memory (CONTEXT.md): ประกอบ context ของหนึ่งเทิร์นจาก PGlite และย่อข้อความเก่าหลังจบเทิร์น
//   Short-term = ข้อความล่าสุด 10-20 ข้อความ (พร้อม tool call/ผล) · Session = สรุปห้องละ 1 ก้อน
//   Long-term = ความจำกลางเฉพาะบรรทัดที่เกี่ยวกับคำถาม
// รับ store กับ generate (LLM) เข้ามา — test ทั้ง flow ได้ด้วย PGlite memory:// กับ generate ปลอม

export const RECENT = 10 // สรุปเสร็จแล้วเหลือข้อความเต็มๆ เท่านี้
export const BATCH = 10 // ข้อความที่ยังไม่สรุปเกิน RECENT + BATCH ค่อยสรุปรอบถัดไป

const SUMMARY_INSTRUCTIONS =
  'ย่อบทสนทนาให้ผู้ช่วยใช้ทำงานต่อ: เป้าหมายของผู้ใช้ คำถามที่ถาม ตาราง/เงื่อนไขที่ตกลงกัน ตัวเลขสำคัญที่ได้ และสิ่งที่ค้างอยู่ เขียนเป็นข้อสั้นๆ ภาษาไทย ไม่เกิน 15 ข้อ ห้ามใส่ชื่อหรือเลขประจำตัวบุคคล'

export function createConversationMemory({ store, generate, prompt }) {
  return {
    // Recent chat + Chat summary + User memory → instructions กับ messages ของเทิร์นนี้
    async contextFor({ conversationId, text }) {
      const db = await store()
      const [convo, memories] = await Promise.all([db.get(conversationId), db.memories()])
      return buildContext({ prompt, convo, memories, text })
    },

    // ย่อข้อความที่หลุดหน้าต่าง recent เข้า summary เดิม — เรียกหลังบันทึกเทิร์น
    async afterTurn(conversationId) {
      const db = await store()
      const convo = await db.get(conversationId)
      const plan = summaryPlan(convo)
      if (!plan) return
      const text = await generate({
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: `${convo.summary ? `สรุปเดิม:\n${convo.summary}\n\n` : ''}บทสนทนาต่อจากนั้น:\n${transcript(convo.messages.slice(plan.from, plan.to))}`
      })
      if (text?.trim()) await db.setSummary(conversationId, text.trim(), plan.to)
    }
  }
}

// ข้อความที่เก็บไว้ → model message ให้ SDK
// เทิร์นก่อนๆ ต้องส่ง tool call + ผลลัพธ์กลับไปด้วย ไม่งั้นโมเดลไม่เห็นว่าเคย SHOW COLUMNS ตารางนี้แล้ว
// ข้อความที่บันทึกก่อนมี modelMessages ถอยไปใช้ข้อความล้วน
export const toModelMessages = (messages = []) =>
  messages.flatMap((m) =>
    m?.modelMessages?.length
      ? m.modelMessages
      : m?.content
        ? [{ role: m.role, content: m.content }]
        : []
  )

const segmenter = new Intl.Segmenter('th', { granularity: 'word' })
const words = (text) =>
  new Set(
    [...segmenter.segment(String(text ?? '').toLowerCase())]
      .filter((s) => s.isWordLike && s.segment.length > 1)
      .map((s) => s.segment)
  )

// ให้คะแนนตามคำที่ตรงกัน คำที่โผล่ในความจำหลายบรรทัด (มี, ที่, ของ) ได้น้ำหนักน้อย
// ponytail: ตัดคำด้วย Intl.Segmenter แล้วนับคำตรงกัน — จับคำพ้องความหมายไม่ได้
//   ความจำเกินหลักร้อยหรือหาไม่เจอบ่อยค่อยเปลี่ยนเป็น embedding
export function relevantMemories(memories, text, limit = 8) {
  const ask = words(text)
  const bags = memories.map(words)
  const df = new Map()
  for (const bag of bags) for (const w of bag) df.set(w, (df.get(w) ?? 0) + 1)
  return memories
    .map((m, i) => ({
      m,
      i,
      score: [...bags[i]].reduce((sum, w) => sum + (ask.has(w) ? 1 / df.get(w) : 0), 0)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m)
}

const textOf = (m) => (typeof m?.content === 'string' ? m.content : '')

export function buildContext({ prompt, convo, memories = [], text }) {
  // ทุกข้อความที่ยังไม่ถูกสรุป — ปกติ 10-20 ข้อความ ถ้าสรุปล้มเหลวจะยาวขึ้นแต่ไม่มีช่องโหว่
  const recent = (convo?.messages ?? []).slice(convo?.summarized ?? 0)
  // คำถามต่อเนื่อง ("แล้วปีที่แล้วล่ะ") ไม่มีคำให้จับ เลยเอาคำถามก่อนหน้ามาช่วยหา
  const lastAsk = textOf(recent.findLast((m) => m.role === 'user'))
  const picked = relevantMemories(memories, `${text} ${lastAsk}`)
  const notes = [
    convo?.summary && `# สรุปบทสนทนาก่อนหน้าในห้องนี้\n${convo.summary}`,
    picked.length &&
      `# ความจำกลางที่เกี่ยวกับคำถามนี้ (ผู้ใช้เคยสั่งให้จำไว้ ใช้ได้เลยไม่ต้องถามซ้ำ)\n${picked.map((m) => `- ${m}`).join('\n')}`
  ].filter(Boolean)
  // system prompt ต้องนิ่งทุกเทิร์น prefix cache ของ provider จะได้โดนทั้ง prompt + history
  // สรุป/ความจำที่เปลี่ยนตามคำถามแยกเป็นข้อความก่อนคำถามล่าสุด ไม่ถูกบันทึกลงประวัติ
  const context = notes.length ? [{ role: 'user', content: `[บริบท]\n${notes.join('\n\n')}` }] : []
  return {
    instructions: prompt,
    messages: [...recent, ...context, { role: 'user', content: text }]
  }
}

// ช่วงข้อความที่ถึงเวลาย่อเข้า summary — null = ยังไม่ต้อง
// ตัดที่ข้อความผู้ใช้เสมอ หน้าต่างที่เหลือจะได้ไม่ขึ้นต้นด้วยคำตอบลอยๆ
export function summaryPlan(convo) {
  const messages = convo?.messages ?? []
  const from = convo?.summarized ?? 0
  if (messages.length - from <= RECENT + BATCH) return null
  let to = messages.length - RECENT
  while (to < messages.length && messages[to].role !== 'user') to++
  return to > from ? { from, to } : null
}

// บทสนทนาสำหรับให้โมเดลย่อ — เอาแค่ข้อความที่คุยกัน ไม่เอาผลตาราง (ข้อมูลรายคนไม่หลุดเข้า summary)
export const transcript = (messages) =>
  messages
    .map((m) => `${m.role === 'user' ? 'ผู้ใช้' : 'ผู้ช่วย'}: ${textOf(m)}`)
    .filter((line) => !/:\s*$/.test(line))
    .join('\n')
