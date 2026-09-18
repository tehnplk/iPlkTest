import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { isAllowed, openApi } from '../src/main/tools/api.mjs'

// --- allowlist ---
const u = (s) => new URL(s)
assert.equal(isAllowed(u('https://a.go.th/x'), ['a.go.th']), true)
assert.equal(isAllowed(u('https://a.go.th/x'), ['b.go.th']), false)
assert.equal(isAllowed(u('https://sub.a.go.th/x'), ['*.a.go.th']), true)
assert.equal(isAllowed(u('https://a.go.th/x'), ['*']), true)
assert.equal(isAllowed(u('http://localhost:8080/x'), ['localhost:8080']), true)
assert.equal(isAllowed(u('http://localhost:9999/x'), ['localhost:8080']), false)
assert.equal(isAllowed(u('https://a.go.th/x'), []), false, 'ไม่ตั้งค่า = ห้ามทั้งหมด')

// --- ยิงจริงใส่เซิร์ฟเวอร์ในเครื่อง ---
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(req.url === '/fail' ? 500 : 200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        got: body,
        auth: req.headers.authorization
      })
    )
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const call = openApi({ allow: `127.0.0.1:${server.address().port}`, token: 'secret-token' })

const ok = await call({ url: `${base}/ping` })
assert.equal(ok.status, 200)
assert.equal(ok.body.method, 'GET')
assert.equal(ok.body.auth, 'Bearer secret-token', 'แอปต้องแนบ token ให้เอง')

const posted = await call({ url: `${base}/save`, method: 'POST', body: '{"hn":"123"}' })
assert.equal(posted.body.got, '{"hn":"123"}')

// สถานะ error ของปลายทางไม่ใช่ข้อผิดพลาดของ tool
assert.equal((await call({ url: `${base}/fail` })).status, 500)

// นอก allowlist / โปรโตคอลแปลก / method แปลก ต้องคืน error ไม่ใช่ยิงออกไป
assert.ok((await call({ url: 'https://evil.example.com/x' })).error)
assert.ok((await call({ url: 'file:///etc/passwd' })).error)
assert.ok((await call({ url: `${base}/x`, method: 'TRACE' })).error)
assert.ok((await call({ url: 'ไม่ใช่ url' })).error)

// ไม่ได้ตั้ง allowlist = เรียกไม่ได้เลย
assert.ok((await openApi({})({ url: `${base}/ping` })).error)

server.close()
console.log('api ok')
