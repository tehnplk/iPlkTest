// สร้าง snapshot ของ sandbox ที่ติดตั้งไลบรารีสถิติไว้แล้ว — เอา id ที่ได้ไปใส่ VERCEL_SNAPSHOT_ID ใน .env
import { buildSnapshot } from '../src/main/tools/stats.mjs'

console.log(`VERCEL_SNAPSHOT_ID=${await buildSnapshot()}`)
