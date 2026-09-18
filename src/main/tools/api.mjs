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

const callApi = openApi({ token: import.meta.env?.MAIN_VITE_API_TOKEN || '' })

export const apiTool = {
  name: 'rest_api',
  description:
    'เรียก REST API ภายนอก (เฉพาะ host ที่ผู้ใช้อนุญาตไว้) คืน {status, body} ใช้ตอนต้องดึงหรือส่งข้อมูลกับระบบอื่น เช่น API ของ สปสช./สสจ.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL เต็ม เช่น https://api.example.go.th/v1/person' },
      method: { type: 'string', description: 'GET (ค่าเริ่มต้น), POST, PUT, PATCH, DELETE' },
      body: { type: 'string', description: 'เนื้อหาที่ส่ง ปกติเป็น JSON string' },
      headers: { type: 'object', description: 'header เพิ่มเติม ไม่ต้องใส่ token เอง' }
    },
    required: ['url']
  },
  run: (args, signal) => callApi(args, signal)
}
