const MAX_BYTES = 200000
const TIMEOUT_MS = 30000
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// ponytail: ยิงได้ทุก host ตามที่ผู้ใช้สั่ง ไม่มี allowlist — โมเดลเข้าถึง 127.0.0.1 และเครื่องใน LAN ได้ด้วย
// ถ้าวันหนึ่งต้องล็อก ให้กลับมาเช็ค hostname ตรงนี้จุดเดียว
export function openApi({ token = '' } = {}) {
  return async function call({ url, method = 'GET', body, headers = {} }, signal) {
    let target
    try {
      target = new URL(url)
    } catch {
      return { error: `URL ไม่ถูกต้อง: ${url}` }
    }
    if (!/^https?:$/.test(target.protocol)) return { error: 'รองรับเฉพาะ http/https' }

    const verb = String(method).toUpperCase()
    if (!METHODS.includes(verb)) return { error: `method ${verb} ไม่รองรับ` }

    const payload = body === undefined || typeof body === 'string' ? body : JSON.stringify(body)
    const timeout = AbortSignal.timeout(TIMEOUT_MS)

    try {
      const res = await fetch(target, {
        method: verb,
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          // token เก็บไว้ฝั่งแอป โมเดลไม่เคยเห็น
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body: payload,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })

      const text = (await res.text()).slice(0, MAX_BYTES)
      let parsed = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // ไม่ใช่ JSON ก็ส่งข้อความดิบกลับไป
      }
      return { status: res.status, body: parsed }
    } catch (err) {
      if (signal?.aborted) throw err
      return { error: `เรียก API ไม่สำเร็จ: ${err.message}` }
    }
  }
}

const callApi = openApi({
  token: process.env.API_TOKEN ?? ''
})

export const apiTool = {
  name: 'rest_api',
  description: `เรียก REST API ภายนอกด้วย http/https ได้ทุก host ตามที่ผู้ใช้สั่ง ใช้ตอนต้องดึงหรือส่งข้อมูลกับระบบอื่น เช่น API ของ สปสช./สสจ.
คืน {status, body} — body เป็น JSON ถ้าแปลงได้ ไม่งั้นเป็นข้อความดิบ ตัดที่ ${MAX_BYTES / 1000} KB
เรียกไม่สำเร็จจะคืน {error} ไม่ throw ให้อ่าน error แล้วแก้ url/method เองก่อนลองใหม่ (timeout ${TIMEOUT_MS / 1000} วินาที)`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'URL เต็มรวม query string เช่น https://api.example.go.th/v1/person?cid=1234567890123'
      },
      method: { type: 'string', enum: METHODS, default: 'GET', description: 'ไม่ใส่ = GET' },
      body: {
        type: 'string',
        description: 'เนื้อหาที่ส่งเป็น JSON string (ระบบใส่ content-type: application/json ให้เอง)'
      },
      headers: {
        type: 'object',
        description: 'header เพิ่มเติม ห้ามใส่ token/รหัสผ่าน แอปแนบ authorization ให้แล้ว'
      }
    },
    required: ['url']
  },
  run: (args, signal) => callApi(args, signal)
}
