// ประกอบบทสนทนาที่เก็บไว้ กลับเป็น model message ให้ SDK
// เทิร์นก่อนๆ ต้องส่ง tool call + ผลลัพธ์กลับไปด้วย ไม่งั้นโมเดลไม่เห็นว่าเคย SHOW COLUMNS
// ตารางนี้แล้ว แล้วไปดูซ้ำในแชทเดียวกัน (prompt ก็บอกโมเดลไว้ว่า history มีให้อยู่แล้ว)
//
// ข้อความที่บันทึกไว้ก่อนมีฟีเจอร์นี้ไม่มี modelMessages — ถอยไปใช้ข้อความล้วนเหมือนเดิม
// ponytail: replay ทุกเทิร์นไม่มีเพดานรวม (ผลแต่ละ tool ถูก fit() ตัดที่ 20k อยู่แล้ว)
//   แชทที่ยาวจนชน context ค่อยตัดเทิร์นเก่าทิ้งตามงบ token
export const toModelMessages = (messages = []) =>
  messages.flatMap((m) =>
    m?.modelMessages?.length
      ? m.modelMessages
      : m?.content
        ? [{ role: m.role, content: m.content }]
        : []
  )
