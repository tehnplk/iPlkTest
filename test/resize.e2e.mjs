// ลากขอบ sidebar ปรับความกว้าง: npm run build && node test/resize.e2e.mjs
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright-core'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()
await win.waitForSelector('.resizer')

const width = () => win.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)
const drag = async (toX) => {
  const box = await win.locator('.resizer').boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + 300)
  await win.mouse.down()
  await win.mouse.move(toX, 300, { steps: 10 })
  await win.mouse.up()
}

assert.equal(await width(), 260, 'ค่าเริ่มต้น 260')
await drag(420)
assert.equal(await width(), 420, 'ลากขยายได้')
await drag(60)
assert.equal(await width(), 180, 'ลากแคบกว่า 180 ต้องหยุดที่ 180')
await drag(900)
assert.equal(await width(), 520, 'ลากกว้างกว่า 520 ต้องหยุดที่ 520')
assert.equal(await win.evaluate(() => localStorage.getItem('sidebarW')), '520', 'จำความกว้างไว้')
await win.evaluate(() => localStorage.removeItem('sidebarW')) // คืนค่าเริ่มต้นให้โปรไฟล์จริง
console.log('resize ok: 260 → 420, clamp 180/520, persisted')
await app.close()
