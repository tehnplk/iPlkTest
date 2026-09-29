// คีย์ระบุตัวคนที่ยอมให้ agent ดึงออกมาได้ อันไหนโผล่ในผลลัพธ์ก็เติมชื่อตามอันนั้น
const KEYS = ['hos_guid', 'person_id']
export const PERSON_COLUMNS = ['cid', 'hn', 'pname', 'fname', 'lname']
const key = (value) =>
  value === null || value === undefined ? '' : String(value).trim().toLowerCase()

// Enrich only an unambiguous direct registry key projection.
export async function chooseHook(sql, columns, signal) {
  signal?.throwIfAborted()
  const clean = String(sql ?? '').replace(/`/g, '')
  if (/['";]|--|#|\/\*|\b(?:with|union|group|count)\b/i.test(clean)) return null
  const match =
    /^\s*select\s+(?:distinct\s+)?([^()]+?)\s+from\s+(patient|person)(?:\s+(?:as\s+)?(?!where\b|limit\b|order\b)([a-z_]\w*))?(?:\s+(?:where|limit|order)\b[\s\S]*)?\s*$/i.exec(
      clean
    )
  if (!match) return null
  const field = match[2].toLowerCase() === 'patient' ? 'hos_guid' : 'person_id'
  const qualifier = (match[3] ?? match[2]).toLowerCase()
  const direct = match[1].split(',').some((part) => {
    const projection = part.trim().toLowerCase()
    const alias = /\s+as\s+(\w+)$/.exec(projection)
    if (alias && alias[1] !== field) return false
    const expr = projection.replace(/\s+as\s+\w+$/, '')
    return expr === field || expr === `${qualifier}.${field}`
  })
  return direct && columns.some((c) => c.toLowerCase() === field) ? field : null
}

// เติม cid, hn, ชื่อ-สกุล ต่อท้ายตาราง {columns, rows} — คืนตัวเดิมถ้าไม่มีคีย์ระบุคน
// ใช้ทั้งกับตารางบนจอและกับไฟล์ Excel ไม่งั้นสองอย่างไม่ตรงกัน
export async function enrichResult(result, sql, lookup, signal, decide = chooseHook) {
  if (result?.error || !Array.isArray(result?.columns) || !Array.isArray(result?.rows))
    return result
  signal?.throwIfAborted()
  // Current query results carry authoritative MySQL origin metadata. A null key
  // means no registry key was selected; never override that with SQL guessing.
  // SQL fallback is only for older saved results without origin metadata.
  const hasOrigin = Object.hasOwn(result, 'personKey')
  const by = hasOrigin ? result.personKey?.by : await decide(sql, result.columns, signal)
  if (!by) return result
  signal?.throwIfAborted()

  const keyIndex = hasOrigin
    ? result.personKey.index
    : result.columns.findIndex((column) => column.toLowerCase() === by)
  if (
    !KEYS.includes(by) ||
    !Number.isInteger(keyIndex) ||
    keyIndex < 0 ||
    keyIndex >= result.columns.length
  )
    return result
  const ids = [...new Set(result.rows.map((row) => row[keyIndex]).filter((id) => key(id)))]
  const people = ids.length ? await lookup(by, ids, signal) : []
  signal?.throwIfAborted()
  const byId = new Map(people.map((person) => [key(person.id), person]))
  return {
    ...result,
    columns: [...result.columns, ...PERSON_COLUMNS],
    rows: result.rows.map((row) => {
      const person = byId.get(key(row[keyIndex]))
      return [...row, ...PERSON_COLUMNS.map((column) => person?.[column] ?? null)]
    })
  }
}

// Only replace the display result. modelMessages remains the original agent history.
export async function appendPersonDetails(answer, lookup, signal, decide = chooseHook) {
  const result = answer?.step?.result
  const enriched = await enrichResult(
    result,
    answer?.step?.querySql ?? answer?.step?.sql,
    lookup,
    signal,
    decide
  )
  return enriched === result ? answer : { ...answer, step: { ...answer.step, result: enriched } }
}
