import { store } from '../store.mjs'

// ความจำเก็บใน PGlite ก้อนเดียวกับประวัติการสนทนา (ตาราง memory)
export const memoryTool = {
  name: 'memory',
  description:
    'ความจำกลางที่ถูกแนบเข้าไปทุกครั้งที่คุยกัน ใช้จำสิ่งที่ผู้ใช้สั่งให้จำ หรือข้อเท็จจริงของโรงพยาบาลนี้ที่กว่าจะค้นเจอต้องไล่หลาย query',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: "'add' เพื่อจำ หรือ 'forget' เพื่อลบ" },
      text: {
        type: 'string',
        description: 'ข้อความสั้นๆ ประโยคเดียว เช่น คลินิกเบาหวาน = clinic 001'
      }
    },
    required: ['action', 'text']
  },
  run: async (args) => {
    const db = await store()
    return args.action === 'forget' ? db.forget(args.text) : db.remember(args.text)
  }
}
