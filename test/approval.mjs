// ทดสอบทางขออนุมัติ (toolApproval ของ AI SDK) ผ่านหน้าจอแอปจริง ทั้งกดอนุมัติและกดปฏิเสธ
//   npm run build && npm run approval
// ต้องปิดแอปที่เปิดค้างไว้ก่อน (PGlite ล็อกโฟลเดอร์ userData ไว้ตัวเดียว)
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright-core'

const t0 = Date.now()
const ms = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`

// ELECTRON_RUN_AS_NODE ที่ติดมาจาก terminal ของ VSCode ทำให้ electron ไม่เปิดหน้าต่าง
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
await win.waitForSelector('.composer textarea')
console.log(ms(), 'เปิดแอปแล้ว')

const ask = async (q) => {
  await win.fill('.composer textarea', q)
  await win.click('.composer button[type=submit]')
  await win.waitForSelector('.composer button.stop')
}

// รอจนตอบจบ ระหว่างทางถ้าเด้งขออนุมัติให้กดตามที่สั่ง (โมเดลขอซ้ำได้ ต้องรับมือทุกครั้ง ไม่งั้นค้าง)
const answer = async (approve) => {
  let asks = []
  for (let i = 0; i < 180; i++) {
    if (await win.locator('.msg.approval').count()) {
      asks.push((await win.locator('.msg.approval .sql').innerText()).trim())
      await win.click(
        approve ? '.msg.approval .approval-buttons button:not(.reject)' : '.msg.approval .reject'
      )
      console.log(ms(), approve ? 'กดอนุมัติ:' : 'กดไม่อนุมัติ:', asks.at(-1))
      continue
    }
    if ((await win.locator('.composer button.stop').count()) === 0) break
    await win.waitForTimeout(1000)
  }
  assert.equal(await win.locator('.composer button.stop').count(), 0, 'ต้องตอบจบ ไม่ใช่ค้าง')
  const msgs = win.locator('.msg')
  return { asks, text: (await msgs.nth((await msgs.count()) - 1).innerText()).trim() }
}

// โมเดลชอบเติม LIMIT ให้เองตามที่ tool สั่ง ถามครั้งเดียวแล้วไม่เด้งไม่ได้แปลว่าพัง — ย้ำอีกรอบก่อนตัดสิน
const askRisky = async (approve) => {
  let r
  for (const q of [
    'รัน SQL นี้ตรงๆ ห้ามแก้ ห้ามใส่ LIMIT: select * from patient',
    'ย้ำว่าต้องเป็น select * from patient เท่านั้น ห้ามเติม LIMIT ห้ามเติม WHERE ห้ามเปลี่ยนเป็น COUNT'
  ]) {
    await ask(q)
    r = await answer(approve)
    if (r.asks.length) break
  }
  return r
}

// 1) คำสั่งเสี่ยง (select * ไม่มี limit) ต้องเด้งขออนุมัติ แล้วกดอนุมัติให้ไปต่อได้
const yes = await askRisky(true)
console.log(ms(), 'คำตอบหลังอนุมัติ:\n' + yes.text.slice(0, 200))
assert.ok(yes.asks.length, 'select * ทั้งตารางต้องเด้งขออนุมัติก่อน')
assert.match(yes.asks[0], /select \* from patient/i, 'args ที่ขออนุมัติต้องเป็น SQL ที่โมเดลขอรัน')
assert.ok(yes.text.length > 0, 'ต้องตอบกลับมาหลังอนุมัติ')
const cells = await win.locator('.result td').count()
assert.ok(cells > 0, 'ต้องมีตารางผลลัพธ์หลังอนุมัติ')

// 2) รอบเดียวกันแต่กดไม่อนุมัติ — ต้องไม่ค้าง ต้องบอกบนจอว่าไม่อนุมัติ และต้องไม่มีแถวใหม่
const no = await askRisky(false)
console.log(ms(), 'คำตอบหลังปฏิเสธ:\n' + no.text.slice(0, 200))
assert.ok(no.asks.length, 'ต้องเด้งขออนุมัติ')
assert.ok(no.text.length > 0, 'ถูกปฏิเสธแล้วยังต้องตอบกลับ ไม่ใช่ค้าง')
assert.match(
  (await win.locator('.result-error').last().innerText()).trim(),
  /ไม่อนุมัติ/,
  'ช่องผลลัพธ์ต้องบอกว่าผู้ใช้ไม่อนุมัติ ไม่ใช่ error ว่างเปล่า'
)
assert.equal(await win.locator('.result td').count(), cells, 'ถูกปฏิเสธแล้วต้องไม่มีแถวใหม่')

await app.close()
console.log('\napproval ok')
