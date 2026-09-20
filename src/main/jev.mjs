// Jev (typesafe) — โมเดลตัดสินใจล้วน ไม่คืนข้อความ คืนความน่าจะเป็นของแต่ละคำถาม
// ต้องยิงตรงที่ OpenRouter เอง ผ่าน LiteLLM proxy ไม่ได้ และ criteria ต้องเขียนเป็นภาษาอังกฤษ
// (วัดแล้วว่าอ่านไทยพลาด ความมั่นใจตกจาก 1.0 เหลือ 0.35 กับเคสเดียวกัน)
//
// ใช้ได้ดีเมื่อหลักฐานอยู่ในข้อความที่ส่งให้ทั้งหมด ถ้าต้องรู้อะไรนอกเหนือจากนั้นมันจะเดา
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
const TIMEOUT_MS = 3000

// บริบทสคีมาที่แนบไปกับทุกคำถาม — jev ไม่มีช่อง system prompt แยก state คือที่ของมัน
// เขียนสั้นและเป็นอังกฤษ (อ่านไทยพลาด) เอาเฉพาะเรื่องที่เปลี่ยนคำตอบ: อะไรอยู่ตารางเดียว
// อะไรต้องไล่หลายตาราง และทะเบียนไหนต้องถอดรหัสก่อนกรอง
export const HOSXP = `HOSxP is a Thai hospital system on MySQL with a few thousand tables.
Join keys: hn (a patient), vn (one OPD visit), an (one admission).
Registries of people: patient (hospital side, key hos_guid) and person (population in the catchment area, key person_id).
One table is usually enough for: patient headcounts, opd_allergy (drug allergy), icd101 (ICD-10 names), pttype (insurance schemes), drugitems, kskdepartment, village.
Two tables are usual for: ovst or vn_stat joined to a registry for visits by scheme, department or month.
Several tables and a registry lookup are needed for preventive care: EPI vaccination runs person_epi to person_epi_vaccine to person_epi_vaccine_list and the epi_vaccine registry, plus summary date columns on person_epi; antenatal care uses person_anc with person_anc_service; women screening uses person_women with person_women_service; labs run lab_head to lab_order to lab_items.
Codes are never guessed: a diagnosis, drug, scheme or vaccine code has to be read out of its registry table before it can be filtered on.
Dates are stored in the Gregorian calendar while users speak in Buddhist years, so a year in the question is usually 543 ahead.`

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
