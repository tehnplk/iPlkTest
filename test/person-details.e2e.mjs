import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright-core'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('.composer textarea')
  await win.fill(
    '.composer textarea',
    'ขอรายชื่อผู้ป่วย 3 คน ใช้ SELECT hos_guid, sex FROM patient WHERE hn IS NOT NULL LIMIT 3'
  )
  await win.click('.composer button[type=submit]')
  await win.waitForSelector('.composer button.stop')
  await win.waitForSelector('.composer button[type=submit]', { timeout: 180000 })
  const message = win.locator('.msg').last()
  assert.equal(await message.locator('.result-error').count(), 0)
  const columns = await message.locator('.result th').allTextContents()
  assert.deepEqual(columns, ['hos_guid', 'sex', 'cid', 'hn', 'pname', 'fname', 'lname'])
  const rows = message.locator('.result tbody tr')
  assert.equal(await rows.count(), 3)
  for (let i = 0; i < 3; i++) {
    const cells = await rows.nth(i).locator('td').allTextContents()
    assert.equal(cells.length, 7)
    assert.match(cells[3], /\d+/, 'hook must populate HN from patient')
  }
  console.log('patient details e2e ok:', columns.join(', '), '| 3 rows')
} finally {
  // ค้างหน้าต่างไว้ให้ดูผลก่อนปิด
  await new Promise((r) => setTimeout(r, 10000))
  await app.close()
}
