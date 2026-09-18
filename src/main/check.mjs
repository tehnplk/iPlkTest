// ตัวกรองก่อนจะเปลืองอีกรอบให้โมเดลตรวจ (รอบตรวจกินเวลา ~20 วิ)
// เลขทุกตัวในคำตอบที่โผล่อยู่ในผลลัพธ์ตรงๆ = คัดลอกมา ไม่ต้องตรวจ
// เลขที่ไม่มีในผลลัพธ์ = โมเดลคิดเอง (บวกเอง ตีความเอง) ตรงนี้แหละที่เคยพลาด
export function needsCheck(answer, result) {
  const nums = (answer.match(/\d[\d,]*(\.\d+)?/g) || []).map((n) => n.replace(/,/g, ''))
  if (!nums.length) return false

  const inResult = new Set(
    (
      JSON.stringify(result)
        .replace(/,/g, ' ')
        .match(/\d+(\.\d+)?/g) || []
    ).map(String)
  )
  return nums.some((n) => !inResult.has(n))
}
