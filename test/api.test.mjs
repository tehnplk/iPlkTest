import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { openApi } from '../src/main/tools/api.mjs'

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

const call = openApi({ token: 'secret-token' })

const ok = await call({ url: `${base}/ping` })
assert.equal(ok.status, 200)
assert.equal(ok.body.method, 'GET')
assert.equal(ok.body.auth, 'Bearer secret-token', 'แอปต้องแนบ token ให้เอง')

const posted = await call({ url: `${base}/save`, method: 'POST', body: '{"hn":"123"}' })
assert.equal(posted.body.got, '{"hn":"123"}')

// สถานะ error ของปลายทางไม่ใช่ข้อผิดพลาดของ tool
assert.equal((await call({ url: `${base}/fail` })).status, 500)

// โปรโตคอลแปลก / method แปลก ต้องคืน error ไม่ใช่ยิงออกไป
assert.ok((await call({ url: 'file:///etc/passwd' })).error, 'อ่านไฟล์ผ่าน tool ไม่ได้')
assert.ok((await call({ url: `${base}/x`, method: 'TRACE' })).error)
assert.ok((await call({ url: 'ไม่ใช่ url' })).error)

// ไม่ต้องตั้งค่าอะไรก็เรียกได้
assert.equal((await openApi()({ url: `${base}/ping` })).status, 200)

server.close()
console.log('api ok')
