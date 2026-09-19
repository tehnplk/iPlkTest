import { app } from 'electron'
import { join } from 'path'
import { openDb } from './db.mjs'

// PGlite ตัวเดียวต่อโฟลเดอร์ ทั้ง index.js และ agent-ai.mjs ต้องใช้ตัวเดียวกัน
// (main ถูก build เป็น CJS ใช้ top-level await ไม่ได้ เลยเป็นฟังก์ชันคืน promise)
let opening = null
export const store = () => (opening ??= openDb(join(app.getPath('userData'), 'pgdata')))
