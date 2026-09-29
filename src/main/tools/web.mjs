// ค้นหาความรู้จากอินเทอร์เน็ต — ใช้ตอนโมเดลต้องรู้เรื่องที่ไม่ได้อยู่ในฐานข้อมูล
// (มาตรฐานรหัส ICD/ICD-10-TM, นิยามตัวชี้วัด, ประกาศ สปสช./สธ., สูตรคำนวณทางคลินิก)
//
// ponytail: ขูดหน้า DuckDuckGo lite ตรงๆ — ฟรี ไม่ต้องขอคีย์เพิ่ม และผลอันดับ 1 เทียบเท่า
// web plugin ของ OpenRouter ที่คิด $0.0078/ครั้ง (ทดสอบด้วยคำถาม ICD-10-TM ได้ลิงก์กรมการ
// แพทย์แผนไทยเหมือนกัน) แลกกับความเปราะ: เขาเปลี่ยน HTML หรือบล็อก IP เมื่อไหร่ก็พัง
// จะย้ายไป Brave/Tavily ให้แก้แค่ฟังก์ชัน search() ตัวเดียว รูปร่างผลลัพธ์เหมือนกัน
const SEARCH_URL = 'https://lite.duckduckgo.com/lite/?q='
const TIMEOUT_MS = 15000
const MAX_RESULTS = 6

// หน้าเว็บยาวได้เป็นแสนตัวอักษร ตัดให้เหลือเท่าที่อ่านรู้เรื่อง (fit() ยังตัดซ้ำอีกชั้น)
const MAX_PAGE_CHARS = 8000

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

// Match parsed hostnames, never trusted-domain text in a path or spoofed suffix.
export function trustedSource(url) {
  try {
    const target = new URL(url)
    return (
      /^https?:$/.test(target.protocol) &&
      !target.username &&
      !target.password &&
      /(?:^|\.)(?:[a-z0-9-]+\.go\.th|[a-z0-9-]+\.ac\.th|[a-z0-9-]+\.gov|[a-z0-9-]+\.edu|who\.int|cdc\.gov|nih\.gov|dmthai\.org|thcc\.or\.th)$/i.test(
        target.hostname
      )
    )
  } catch {
    return false
  }
}

// เอา tag ออกให้เหลือข้อความที่คนอ่านได้ — script/style ต้องทิ้งทั้งก้อน ไม่ใช่แค่ถอด tag
const text = (html) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

// ลิงก์ของ DDG ถูกห่อเป็น //duckduckgo.com/l/?uddg=<url ที่ encode ไว้>
const unwrap = (href) => {
  const m = /[?&]uddg=([^&]+)/.exec(href)
  try {
    return m ? decodeURIComponent(m[1]) : href
  } catch {
    return href
  }
}

async function search(query, signal) {
  const res = await fetch(SEARCH_URL + encodeURIComponent(query), {
    headers: { 'user-agent': UA },
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) return { error: `ค้นหาไม่สำเร็จ (HTTP ${res.status})` }
  const html = await res.text()

  // แต่ละผลลัพธ์คือ <a class='result-link'> แล้วตามด้วย <td class='result-snippet'> ในแถวถัดไป
  const re =
    /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g
  const results = []
  let m
  while ((m = re.exec(html)) && results.length < MAX_RESULTS)
    results.push({ title: text(m[2]), url: unwrap(m[1]), snippet: text(m[3]).slice(0, 300) })

  // ไม่เจอ = คำค้นไม่มีผล หรือเขาเปลี่ยนหน้าเว็บ/บล็อกเรา ต้องแยกให้ออกจาก "ค้นแล้วไม่มี"
  if (!results.length)
    return { error: 'ไม่พบผลการค้นหา (หรือเครื่องมือค้นหาเปลี่ยนรูปแบบหน้าเว็บ)', results: [] }

  signal?.throwIfAborted()
  const keep = results.filter((result) => trustedSource(result.url))
  return {
    results: keep,
    dropped: results.length - keep.length,
    ...(!keep.length ? { warning: 'ไม่มีแหล่งที่ผ่าน regex guardrail ให้ปรับคำค้น' } : {})
  }
}

async function read(url, signal) {
  let target
  try {
    target = new URL(url)
  } catch {
    return { error: `URL ไม่ถูกต้อง: ${url}` }
  }
  if (!/^https?:$/.test(target.protocol)) return { error: 'รองรับเฉพาะ http/https' }

  const res = await fetch(target, {
    headers: { 'user-agent': UA },
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS)
  })
  const type = res.headers.get('content-type') ?? ''
  // PDF/ไฟล์แนบอ่านไม่ได้ ต้องบอกให้ชัด ไม่งั้นโมเดลได้ byte มั่วๆ แล้วแต่งเนื้อหาเอง
  if (!/text\/html|text\/plain|application\/json/i.test(type))
    return { url: target.href, error: `อ่านไม่ได้ เป็นไฟล์ชนิด ${type || 'ไม่ทราบ'} (เช่น PDF)` }

  const body = text(await res.text())
  return {
    url: target.href,
    status: res.status,
    content: body.slice(0, MAX_PAGE_CHARS),
    truncated: body.length > MAX_PAGE_CHARS
  }
}

export const webTool = {
  name: 'tool_web_search',
  description: `ค้นหาความรู้จากอินเทอร์เน็ต ใช้เมื่อต้องรู้เรื่องที่ไม่ได้อยู่ในฐานข้อมูลโรงพยาบาล
เช่น มาตรฐานรหัส ICD-10 / ICD-10-TM, นิยามตัวชี้วัด, เกณฑ์ สปสช., สูตรคำนวณทางคลินิก
ใส่ query = ค้นหา คืน {results:[{title,url,snippet}]} — ระบบคัดแหล่งที่ไม่เป็นทางการทิ้งให้แล้ว
ใส่ url = อ่านเนื้อหาหน้านั้นเป็นข้อความ คืน {content}  (อ่าน PDF ไม่ได้)
ค้นก่อนแล้วค่อยอ่านหน้าที่ดูตรงที่สุด อย่าอ่านทุกลิงก์`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'คำค้น ใส่คำอังกฤษด้วยถ้าเป็นศัพท์เทคนิค' },
      url: { type: 'string', description: 'ใส่เมื่อจะอ่านหน้าเว็บที่ได้จากผลค้นหา' }
    }
  },
  run: async ({ query, url }, signal) => {
    if (url) return read(url, signal)
    if (!query?.trim()) return { error: 'ต้องใส่ query หรือ url อย่างใดอย่างหนึ่ง' }
    try {
      return await search(query, signal)
    } catch (e) {
      return { error: `ค้นหาไม่สำเร็จ: ${e.message}` }
    }
  }
}
