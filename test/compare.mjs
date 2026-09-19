// เทียบ engine loop กับ sdk บนคำถามชุดเดียวกัน ผ่านหน้าจอแอปจริง
//   npm run build && npm run compare
import { _electron as electron } from 'playwright-core'

// ค่าจริงในฐาน hos_07547 ใช้ตัดสินว่าคำตอบถูกไหม (นับเองด้วย SQL ตรงๆ มาก่อนแล้ว)
const CASES = [
  { q: 'มีผู้ป่วยทั้งหมดกี่คน แยกตามเพศ', expect: /6[,.]?615/, ต้องมี: 'ยอดรวม 6,615' },
  { q: 'คนไข้ที่เคยตรวจ HbA1c มีกี่คน', expect: /235/, ต้องมี: '235 คน' },
  { q: 'ขอรายชื่อผู้ป่วย 5 คนล่าสุด', expect: null, ต้องมี: 'ตารางมีแถว' }
]

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
await win.waitForSelector('.composer textarea')

const ask = async (engine, question) => {
  await win.click('.new-chat')
  await win.selectOption('.chat-header select >> nth=0', engine)
  await win.fill('.composer textarea', question)
  const t = Date.now()
  await win.click('.composer button[type=submit]')
  await win.waitForSelector('.composer button.stop')

  // ฝั่ง sdk อาจหยุดขออนุมัติ — กดอนุมัติให้เพื่อให้เทียบกันได้จนจบ
  const done = win.waitForSelector('.composer button[type=submit]', { timeout: 240000 })
  const approve = win
    .waitForSelector('.approval button', { timeout: 240000 })
    .then((b) => b.click())
    .catch(() => {})
  await Promise.race([done, approve.then(() => done)])
  await done

  const msgs = win.locator('.msg')
  const answer = (await msgs.nth((await msgs.count()) - 1).innerText()).trim()
  return {
    sec: ((Date.now() - t) / 1000).toFixed(1),
    sql: (
      await win
        .locator('.sql-box summary')
        .last()
        .innerText()
        .catch(() => '')
    ).trim(),
    rows: await win.locator('.result tbody tr').count(),
    verified: (await win.locator('.verified').count()) > 0,
    answer: answer.split('\n').filter(Boolean).slice(-3).join(' ')
  }
}

for (const c of CASES) {
  console.log(`\n${'='.repeat(70)}\nคำถาม: ${c.q}   (เกณฑ์: ${c.ต้องมี})`)
  for (const engine of ['loop', 'sdk', 'ai']) {
    const r = await ask(engine, c.q)
    const ok = c.expect ? c.expect.test(r.answer.replace(/\s/g, '')) : r.rows > 0
    console.log(
      `\n[${engine}] ${r.sec}s  ${ok ? '✓ ถูก' : '✗ ผิด'}  แถวในตาราง: ${r.rows}${r.verified ? '  (ผ่านรอบตรวจ)' : ''}`
    )
    console.log(`  SQL: ${r.sql.slice(0, 110)}`)
    console.log(`  ตอบ: ${r.answer.slice(0, 220)}`)
  }
}

await app.close()
console.log('\nเทียบเสร็จ')
