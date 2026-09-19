// ทดสอบแชทจริงผ่านหน้าจอแอป: เปิด Electron → พิมพ์คำถาม → รอคำตอบ → ตรวจสิ่งที่ขึ้นบนจอ
//   npm run build && npm run e2e
// ต้องปิดแอปที่เปิดค้างไว้ก่อน (PGlite ล็อกโฟลเดอร์ userData ไว้ตัวเดียว)
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright-core'

const question = process.argv[2] || 'มีผู้ป่วยทั้งหมดกี่คน ตอบสั้นๆ'
const t0 = Date.now()
const ms = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`

// ELECTRON_RUN_AS_NODE ที่ติดมาจาก terminal ของ VSCode ทำให้ electron ไม่เปิดหน้าต่าง
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ args: ['.'], env })
// log ของ main process ไม่งั้นเวลาเทสต์ล้มจะมองไม่เห็นว่าข้างในเกิดอะไรขึ้น
app.process().stdout?.on('data', (d) => process.stdout.write(String(d)))
const win = await app.firstWindow()
await win.waitForSelector('.composer textarea')
console.log(ms(), 'เปิดแอปแล้ว:', await win.title())

await win.fill('.composer textarea', question)
await win.click('.composer button[type=submit]')
console.log(ms(), 'ส่งคำถาม:', question)

// ปุ่มกลายเป็น "หยุด" ระหว่างทำงาน รอจนกลับมาเป็น "ส่ง" = ตอบเสร็จ
await win.waitForSelector('.composer button.stop')
await win.waitForSelector('.composer button[type=submit]', { timeout: 180000 })

const messages = win.locator('.msg')
const count = await messages.count()
const answer = (await messages.nth(count - 1).innerText()).trim()
const sql = (
  await win
    .locator('.sql-box summary')
    .last()
    .innerText()
    .catch(() => '')
).trim()
const cells = await win.locator('.result td').count()

console.log(ms(), 'SQL ที่ใช้:', sql || '(ไม่ได้ query)')
console.log(ms(), 'ช่องในตาราง:', cells)
console.log(ms(), 'คำตอบ:\n' + answer)

assert.ok(count >= 2, 'ต้องมีทั้งข้อความผู้ใช้และคำตอบ')
assert.ok(answer.length > 0, 'คำตอบต้องไม่ว่าง')
assert.ok(!/^⚠/.test(answer), 'คำตอบไม่ควรเป็นข้อความ error')

await app.close()
console.log('\ne2e ok')
