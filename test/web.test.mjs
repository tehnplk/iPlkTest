import assert from 'node:assert/strict'
import { webTool } from '../src/main/tools/web.mjs'

const real = globalThis.fetch
const stub = (body, { ok = true, status = 200, type = 'text/html' } = {}) => {
  globalThis.fetch = async () => ({
    ok,
    status,
    headers: { get: () => type },
    text: async () => body
  })
}
const restore = () => {
  globalThis.fetch = real
}

// หน้าผลค้นหาจริงของ DuckDuckGo lite ใช้ single quote และห่อลิงก์ไว้ใน uddg=
const PAGE = `<table>
<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dtam.moph.go.th%2Ficd.pdf&amp;rut=abc" class='result-link'><span class="result__type">PDF</span> บัญชีรหัส ICD-10-TM</a></td></tr>
<tr><td class='result-snippet'>รหัสการแพทย์แผนไทย <b>ICD-10-TM</b> ...</td></tr>
<tr><td><a href="//duckduckgo.com/l/?uddg=http%3A%2F%2Fthcc.or.th%2Ficd10tm.php" class='result-link'>ศูนย์มาตรฐานรหัส</a></td></tr>
<tr><td class='result-snippet'>งานพัฒนามาตรฐานรหัส</td></tr>
</table>`

stub(PAGE)
const found = await webTool.run({ query: 'ICD-10-TM' })
assert.equal(found.results.length, 2)
// ต้องคาย url จริงออกมา ไม่ใช่ลิงก์ redirect ของ duckduckgo (โมเดลเอาไปอ่านต่อไม่ได้)
assert.equal(found.results[0].url, 'https://www.dtam.moph.go.th/icd.pdf')
assert.equal(found.results[1].url, 'http://thcc.or.th/icd10tm.php')
// tag กับ entity ต้องหายไปหมด เหลือข้อความที่อ่านได้
assert.equal(found.results[0].title, 'PDF บัญชีรหัส ICD-10-TM')
assert.match(found.results[0].snippet, /^รหัสการแพทย์แผนไทย ICD-10-TM/)
assert.ok(!JSON.stringify(found).includes('<'), 'ห้ามมี tag หลุดไปถึงโมเดล')

// หน้าเปลี่ยนรูปแบบ/โดนบล็อก ต้องแยกออกจาก "ค้นแล้วไม่เจอ" ไม่ใช่เงียบๆ คืนว่าง
stub('<html>nothing here</html>')
const empty = await webTool.run({ query: 'อะไรสักอย่าง' })
assert.ok(empty.error, 'ไม่เจอผลต้องบอกว่าไม่เจอ')
assert.deepEqual(empty.results, [])

stub('', { ok: false, status: 503 })
assert.match((await webTool.run({ query: 'x' })).error, /503/)

// อ่านหน้าเว็บ: script/style ต้องทิ้งทั้งก้อน ไม่ใช่ถอดแค่ tag แล้วเหลือโค้ดปนในเนื้อหา
stub('<html><style>body{color:red}</style><script>alert(1)</script><p>เนื้อหา จริง</p></html>')
const page = await webTool.run({ url: 'https://example.com/a' })
assert.equal(page.content, 'เนื้อหา จริง')
assert.equal(page.truncated, false)

// ยาวเกินเพดานต้องตัดและบอกว่าตัด
stub('<p>' + 'ก'.repeat(20000) + '</p>')
const long = await webTool.run({ url: 'https://example.com/b' })
assert.equal(long.content.length, 8000)
assert.equal(long.truncated, true)

// PDF อ่านไม่ได้ ต้องบอกตรงๆ ไม่งั้นโมเดลได้ byte มั่วๆ แล้วแต่งเนื้อหาเอง
stub('%PDF-1.4 ...', { type: 'application/pdf' })
assert.match((await webTool.run({ url: 'https://example.com/c.pdf' })).error, /PDF/)

// url พังหรือ protocol แปลกๆ ต้องไม่ยิงออกไป
const never = () => assert.fail('ห้ามยิงเมื่อ url ใช้ไม่ได้')
globalThis.fetch = never
assert.match((await webTool.run({ url: 'ไม่ใช่ url' })).error, /URL ไม่ถูกต้อง/)
assert.match((await webTool.run({ url: 'file:///etc/passwd' })).error, /http/)
assert.match((await webTool.run({ query: '   ' })).error, /query หรือ url/)

// เน็ตหลุดตอนค้นหา ต้องกลายเป็น error ไม่ใช่โยนทิ้งให้ทั้งเทิร์นพัง
globalThis.fetch = async () => {
  throw new Error('ECONNRESET')
}
assert.match((await webTool.run({ query: 'x' })).error, /ECONNRESET/)

// --- jev คัดแหล่งที่ไม่น่าเชื่อถือ: ยิงคำถามครบทุกแหล่งในคำขอเดียว แล้วทิ้งตัวที่ต่ำกว่าเพดาน
const jev = (scores) => async (url, opt) => {
  if (!String(url).includes('decisions'))
    return { ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => PAGE }
  sentToJev = JSON.parse(opt.body)
  const answers = {}
  scores.forEach((n, i) => (answers[`r${i}`] = { type: 'noul', noul: n }))
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ answers })
  }
}
let sentToJev = null

process.env.OPENROUTER_API_KEY = 'test-key'
globalThis.fetch = jev([0.9, 0.03])
const filtered = await webTool.run({ query: 'x' }, undefined, { ask: 'คำถามผู้ใช้' })
assert.equal(filtered.results.length, 1, 'แหล่งที่ได้ 0.03 ต้องถูกคัดทิ้ง')
assert.equal(filtered.dropped, 1)
assert.match(filtered.results[0].url, /dtam/)
assert.equal(sentToJev.state.topic, 'คำถามผู้ใช้')
// url ต้องถึง jev ด้วย ไม่ใช่แค่ title/snippet — โดเมนคือหลักฐานหลักว่าแหล่งน่าเชื่อถือไหม
assert.ok(sentToJev.state.source_0.startsWith('https://www.dtam.moph.go.th'))
assert.equal(
  Object.keys(sentToJev.questions).length,
  2,
  'ต้องถามทุกแหล่งในคำขอเดียว ไม่ยิงทีละครั้ง'
)
assert.equal(sentToJev.questions.r0.type, 'noul')

// ไม่มีแหล่งไหนผ่านเลย — ส่งของเดิมไปแต่ต้องติดป้ายเตือน ไม่ใช่คืนมือเปล่าจนโมเดลคิดว่าไม่มีข้อมูล
globalThis.fetch = jev([0.01, 0.02])
const none = await webTool.run({ query: 'x' }, undefined, { ask: 'q' })
assert.equal(none.results.length, 2)
assert.match(none.warning, /ระมัดระวัง/)

// jev ตอบไม่ครบ/ล่ม/ไม่มี ask = ไม่คัด ส่งผลดิบทั้งหมด
globalThis.fetch = jev([0.9])
assert.equal((await webTool.run({ query: 'x' }, undefined, { ask: 'q' })).results.length, 2)
stub(PAGE)
assert.equal((await webTool.run({ query: 'x' })).results.length, 2)
delete process.env.OPENROUTER_API_KEY
globalThis.fetch = jev([0.9, 0.03])
assert.equal((await webTool.run({ query: 'x' }, undefined, { ask: 'q' })).results.length, 2)

restore()
console.log('web ok')
