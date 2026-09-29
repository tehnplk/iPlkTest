// Display result (CONTEXT.md): ผลที่สำเร็จซึ่งรองรับคำตอบ — ตาราง กราฟ ไฟล์ Excel หรือผลวิเคราะห์สถิติ
// เจ้าของเดียวของ: เลือกผลที่โชว์, สคริปต์ SQL ของตาราง tmp_, เทียบ COUNT กับตัวเลขในคำตอบ
// ทำงานบน toolSteps ดิบ (เรียงตามลำดับที่เสร็จ) เสมอ ไม่รับ step ที่ถูกแปลงแล้วกลับเข้ามา

const METADATA = /^\s*(show|desc|describe|explain)\b/i
const TEMP = /\btmp_/i
const COUNT = /^\s*select\s+count\s*\(/i

const isDisplay = (step) => {
  const r = step.result
  if (!r || r.error || METADATA.test(step.sql ?? '')) return false
  if (r.stdout !== undefined) return !r.exitCode
  return Boolean(
    r.chart || r.file || (Array.isArray(r.columns) && r.columns.length && Array.isArray(r.rows))
  )
}

const isCount = (step) =>
  COUNT.test(step?.sql ?? '') &&
  step.result?.columns?.length === 1 &&
  step.result?.rows?.length === 1

// ตัวเลขในคำตอบไม่มีตัวไหนตรงกับผล COUNT ค่าเดียว — เทียบตรงตัวได้เฉพาะ COUNT ไม่ได้ตรวจความหมาย
export function countMismatch(text, step) {
  if (!isCount(step)) return false
  const digits = String(text ?? '').replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50))
  const expected = Number(String(step.result.rows[0][0]).replace(/,/g, ''))
  const numbers = digits.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []
  return numbers.length > 0 && !numbers.some((n) => Number(n.replace(/,/g, '')) === expected)
}

// สคริปต์ที่ copy ไปรันแล้วได้ผลเดียวกับที่โชว์: คำสั่ง tmp_ ที่สำเร็จตั้งแต่ต้นเทิร์นจนถึงผลนี้
const scriptFor = (steps, step) => {
  if (!TEMP.test(step.sql ?? '')) return step.sql
  return steps
    .slice(0, steps.indexOf(step) + 1)
    .filter((s) => !s.result?.error && TEMP.test(s.input?.sql ?? ''))
    .map((s) => s.input.sql)
    .join(';\n\n')
}

// ไม่มี answerText = ผลล่าสุด; มี = ถ้ามี COUNT เพียงตัวเดียวที่ตรงกับตัวเลขในคำตอบให้เลือกตัวนั้น
// step: sql = สคริปต์ที่โชว์, querySql = คำสั่งเดียวที่ได้ผลนี้ | null ถ้าไม่มีผลที่เข้าเกณฑ์
export function selectDisplay(steps = [], answerText) {
  const shown = steps.filter(isDisplay)
  let chosen = shown.at(-1)
  if (answerText !== undefined && /[0-9๐-๙]/.test(answerText)) {
    const matches = shown.filter((s) => isCount(s) && !countMismatch(answerText, s))
    if (matches.length === 1) chosen = matches[0]
  }
  if (!chosen) return { step: null, mismatch: false }
  return {
    step: { ...chosen, querySql: chosen.sql, sql: scriptFor(steps, chosen) },
    mismatch: answerText !== undefined && countMismatch(answerText, chosen)
  }
}
