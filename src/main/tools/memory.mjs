import { relevantMemories } from '../conversation-memory.mjs'

// ความจำเก็บใน PGlite ก้อนเดียวกับประวัติการสนทนา (ตาราง memory)
export const memoryTool = {
  name: 'tool_memory',
  description: `ความจำกลาง ใช้จำสิ่งที่ผู้ใช้สั่งให้จำ หรือข้อเท็จจริงของโรงพยาบาลนี้ที่กว่าจะค้นเจอต้องไล่หลาย query
ความจำที่เกี่ยวกับคำถามถูกแนบในหัวข้อ "ความจำกลางที่เกี่ยวกับคำถามนี้" ของ prompt อยู่แล้ว ไม่ต้องบันทึกซ้ำ
ถ้าไม่เจอเรื่องที่ต้องการ ใช้ search ด้วยคำสำคัญก่อนไปค้นในฐานข้อมูล
คืน {saved} เมื่อจำ, {forgot} เมื่อลบ, {found} เมื่อค้น`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'forget', 'search'],
        description: 'add = จำ, forget = ลบ, search = ค้นความจำ'
      },
      text: {
        type: 'string',
        description:
          'ประโยคเดียวสั้นๆ ที่อ่านแล้วใช้ได้เลย เช่น คลินิกเบาหวาน = clinic 001 (ตอน forget ใส่ข้อความที่เคยจำไว้, ตอน search ใส่คำสำคัญ)'
      }
    },
    required: ['action', 'text']
  },
  // store มาจาก ctx (ห้องแชท/ความจำใน PGlite) — ไฟล์นี้ไม่ผูกกับ electron และ test ด้วย memory:// ได้
  run: async (args, _signal, { store }) => {
    const db = await store()
    if (args.action === 'search')
      return { found: relevantMemories(await db.memories(), args.text, 20) }
    return args.action === 'forget' ? db.forget(args.text) : db.remember(args.text)
  }
}
