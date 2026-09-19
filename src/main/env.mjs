// โหลด .env ตอนเปิดแอป ไม่ใช่ตอน build — เลยไม่ต้องใช้ prefix MAIN_VITE_ ของ electron-vite
// ผลพลอยได้: แก้คีย์/base url แล้วเปิดแอปใหม่พอ ไม่ต้อง build ใหม่ และคีย์ไม่ถูกฝังลงบันเดิล
// ไฟล์นี้ต้องถูก import เป็นตัวแรกใน index.js ก่อนโมดูลที่อ่าน process.env ตอนโหลด
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

// ตอน dev อยู่ที่รากโปรเจกต์ ตอนแพ็กเป็นแอปแล้วให้วางไว้ข้างไฟล์ .exe
const files = [join(process.cwd(), '.env'), join(dirname(app.getPath('exe')), '.env')]

export const envFile = files.find((f) => existsSync(f)) ?? null
if (envFile) process.loadEnvFile(envFile)
