// ความจำเก็บใน PGlite ก้อนเดียวกับประวัติการสนทนา (ตาราง memory)
export const memoryTool = {
  name: 'memory',
  description: `ความจำกลางที่ถูกแนบเข้า system prompt ทุกครั้งที่คุยกัน ใช้จำสิ่งที่ผู้ใช้สั่งให้จำ หรือข้อเท็จจริงของโรงพยาบาลนี้ที่กว่าจะค้นเจอต้องไล่หลาย query
ไม่ต้องอ่าน — ของที่จำไว้แล้วอยู่ในหัวข้อ "ความจำกลาง" ของ prompt อยู่แล้ว ไม่ต้องบันทึกซ้ำ
คืน {saved} เมื่อจำ หรือ {forgot} เมื่อลบ`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'forget'], description: 'add = จำ, forget = ลบ' },
      text: {
        type: 'string',
        description:
          'ประโยคเดียวสั้นๆ ที่อ่านแล้วใช้ได้เลย เช่น คลินิกเบาหวาน = clinic 001 (ตอน forget ใส่ข้อความที่เคยจำไว้)'
      }
    },
    required: ['action', 'text']
  },
  run: async (args) => {
    // import ตอนใช้จริง เพราะ store.mjs ผูกกับ electron (ไฟล์นี้จะได้ยัง import ด้วย node ได้)
    const { store } = await import('../store.mjs')
    const db = await store()
    return args.action === 'forget' ? db.forget(args.text) : db.remember(args.text)
  }
}
