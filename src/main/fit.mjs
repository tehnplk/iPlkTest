// เพดานผลลัพธ์ที่ส่งเข้า context ของโมเดล (ราว 5 พัน token) — กว้างพอให้ SHOW COLUMNS ตารางใหญ่ผ่านครบ
const MODEL_CHARS = 20000

// จอได้ผลเต็มจาก part.output อยู่แล้ว โมเดลไม่ต้องเห็นครบก็ตอบได้ (prompt ห้ามพิมพ์ข้อมูลซ้ำอยู่แล้ว)
// ไม่ตัด = select * ตารางกว้างๆ กิน context เป็นแสนตัวอักษรต่อ call เดียว
export const fit = (out) => {
  if (!out || typeof out !== 'object' || JSON.stringify(out).length <= MODEL_CHARS) return out

  if (Array.isArray(out.rows)) {
    let keep = out.rows.length
    while (
      keep > 1 &&
      JSON.stringify({ ...out, rows: out.rows.slice(0, keep) }).length > MODEL_CHARS
    )
      keep = Math.floor(keep / 2)
    return {
      ...out,
      rows: out.rows.slice(0, keep),
      truncated: true,
      note: `ส่งให้โมเดลแค่ ${keep} แถวแรกจาก ${out.rowCount} แถว (ผู้ใช้เห็นตารางเต็มบนจอแล้ว) ถ้าต้องสรุปทั้งหมดให้ query ใหม่ด้วย COUNT/GROUP BY แทนการไล่อ่านแถว`
    }
  }

  // body ของ rest_api ยาวได้ถึง 200 KB ตัดให้เหลือเท่าที่อ่านรู้เรื่อง
  if (out.body !== undefined)
    return {
      ...out,
      body: (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)).slice(
        0,
        MODEL_CHARS
      ),
      truncated: true
    }

  return out
}
