// Jev (typesafe) — โมเดลตัดสินใจล้วน ไม่คืนข้อความ คืนความน่าจะเป็นของแต่ละคำถาม
// ต้องยิงตรงที่ OpenRouter เอง ผ่าน LiteLLM proxy ไม่ได้ และ criteria ต้องเขียนเป็นภาษาอังกฤษ
// (วัดแล้วว่าอ่านไทยพลาด ความมั่นใจตกจาก 1.0 เหลือ 0.35 กับเคสเดียวกัน)
//
// ใช้ได้ดีเมื่อหลักฐานอยู่ในข้อความที่ส่งให้ทั้งหมด ถ้าต้องรู้อะไรนอกเหนือจากนั้นมันจะเดา
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
const TIMEOUT_MS = 3000

// คืน answers หรือ null = ตัดสินไม่ได้ (ไม่มีคีย์/ล่ม/ช้า) — ผู้เรียกต้องเดินต่อได้เสมอเมื่อได้ null
export async function askJev(state, questions, signal) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.JEV_MODEL || 'jev-latest', state, questions }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null
    return (await res.json())?.answers ?? null
  } catch {
    return null
  }
}
