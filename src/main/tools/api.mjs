const MAX_BYTES = 200000
const TIMEOUT_MS = 30000
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// ponytail: กันด้วย allowlist ของ host เท่านั้น ไม่ได้กัน SSRF ระดับ IP (127.x/169.254.x)
// ถ้าเปิดให้ยิงเน็ตกว้างๆ ควรตั้งรายชื่อ host ให้แคบไว้
export function isAllowed(url, allow) {
  if (!allow.length) return false
  if (allow.includes('*')) return true
  const host = url.host.toLowerCase() // มี port ติดมาด้วยถ้าระบุ
  const name = url.hostname.toLowerCase()
  return allow.some((a) => {
    const rule = a.trim().toLowerCase()
    if (!rule) return false
    if (rule.startsWith('*.')) return name.endsWith(rule.slice(1))
    return rule === host || rule === name
  })
}

export function openApi({ allow = '', token = '' }) {
  const hosts = allow.split(',').filter(Boolean)

  return async function call({ url, method = 'GET', body, headers = {} }, signal) {
    let target
    try {
      target = new URL(url)
    } catch {
      return { error: `URL ไม่ถูกต้อง: ${url}` }
    }
    if (!/^https?:$/.test(target.protocol)) return { error: 'รองรับเฉพาะ http/https' }
    if (!hosts.length)
      return {
        error: 'ยังไม่ได้ตั้งค่า MAIN_VITE_API_ALLOW ผู้ใช้ต้องอนุญาต host ก่อนถึงจะเรียก API ได้'
      }
    if (!isAllowed(target, hosts))
      return { error: `host ${target.host} ไม่อยู่ในรายการที่อนุญาต (${hosts.join(', ')})` }

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

// ค่าเริ่มต้นเปิดให้เรียกได้ทุก host ตามที่ผู้ใช้สั่ง — ใส่รายชื่อใน MAIN_VITE_API_ALLOW เมื่อต้องการจำกัด
const callApi = openApi({
  allow: import.meta.env?.MAIN_VITE_API_ALLOW || '*',
  token: import.meta.env?.MAIN_VITE_API_TOKEN || ''
})

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
