import mysql from 'mysql2/promise'

const MAX_ROWS = 200
const TIMEOUT_SEC = 60

// คำสั่งที่แตะ temp table ต้องอยู่ connection เดิม และต้องถูกรวมเป็นสคริปต์เดียวตอนโชว์ให้ผู้ใช้
export const isTemp = (sql) => /\btmp_/i.test(sql ?? '')

const READ = /^\s*(select|show|desc|describe|explain|with|set\s)/i
const TMP =
  /^\s*(create\s+temporary\s+table|insert\s+into\s+`?tmp_|update\s+`?tmp_|delete\s+from\s+`?tmp_|drop\s+(temporary\s+)?table\s+(if\s+exists\s+)?`?tmp_)/i

// Preserve positions while masking strings/comments. In MySQL, -- is a comment
// only when followed by whitespace/control; 1--1 is arithmetic. Quoted text wins
// over comment markers. Executable comments must never disappear from inspection.
function scanSql(sql) {
  let text = ''
  let scan = ''
  for (let i = 0; i < sql.length;) {
    const start = i
    const quote = sql[i]
    if (quote === "'" || quote === '"' || quote === '`') {
      i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' && quote !== '`') {
          i += 2
          continue
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) return { error: 'SQL มีเครื่องหมายคำพูดไม่ครบ' }
      const token = sql.slice(start, i)
      text += quote === '`' ? token : quote + ' '.repeat(token.length - 2) + quote
      scan += ' '.repeat(token.length)
    } else if (sql.startsWith('/*', i)) {
      if (/^\/\*(?:!|m!)/i.test(sql.slice(i)))
        return {
          error: 'ไม่อนุญาต executable comment ใน SQL เพราะอาจซ่อนคำสั่งหรือข้อมูลส่วนบุคคล'
        }
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) return { error: 'SQL มีคอมเมนต์ที่ปิดไม่ครบ' }
      i = end + 2
      text += ' '.repeat(i - start)
      scan += ' '.repeat(i - start)
    } else if (
      sql[i] === '#' ||
      (sql.startsWith('--', i) && (sql.charCodeAt(i + 2) <= 32 || /\s/.test(sql[i + 2] ?? '')))
    ) {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++
      text += ' '.repeat(i - start)
      scan += ' '.repeat(i - start)
    } else {
      text += sql[i]
      scan += sql[i]
      i++
    }
  }
  return { text, scan: scan.toLowerCase() }
}

// Inspect SELECT projections; WHERE/JOIN keys do not themselves leave the DB.
function projections(sql) {
  const parsed = scanSql(sql)
  if (parsed.error) return [] // checkSql/checkLeak reject malformed input first.
  const { scan: low, text } = parsed
  const word = (i) => /[\w$]/.test(low[i] ?? '')
  const out = []
  const re = /\bselect\b/g
  while (re.exec(low)) {
    let depth = 0
    let i = re.lastIndex
    for (; i < low.length; i++) {
      if (low[i] === '(') depth++
      else if (low[i] === ')') {
        if (!depth) break
        depth--
      } else if (!depth && low.startsWith('from', i) && !word(i - 1) && !word(i + 4)) break
    }
    out.push(text.slice(re.lastIndex, i))
  }
  return out
}

// คีย์ระบุตัวคนที่ agent ใช้ได้ — patient.hos_guid กับ person.person_id (person.hos_guid ซ้ำ ใช้ไม่ได้)
// person ไม่มี hn ต่อผ่าน cid เอา (ได้ 6,280/6,299 แถว) GROUP BY กัน cid ซ้ำไม่ให้แตกเป็นหลายแถว
const PERSON_LOOKUP = {
  hos_guid: 'SELECT hos_guid AS id, cid, hn, pname, fname, lname FROM patient WHERE hos_guid IN',
  person_id: `SELECT p.person_id AS id, p.cid, MIN(pt.hn) AS hn, p.pname, p.fname, p.lname
    FROM person p LEFT JOIN patient pt ON pt.cid = p.cid AND p.cid <> ''
    WHERE p.person_id IN`
}
const GROUP_BY = { person_id: ' GROUP BY p.person_id' }

const METADATA = /^\s*(show|desc|describe|explain)\b/i

// แยก projection เป็นรายคอลัมน์ที่ระดับบนสุด (คอมมาในวงเล็บของ CONCAT/COUNT ไม่นับ)
function splitColumns(projection) {
  const parsed = scanSql(projection)
  if (parsed.error) return []
  const structural = parsed.scan
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < projection.length; i++) {
    if (structural[i] === '(') depth++
    else if (structural[i] === ')') depth--
    else if (structural[i] === ',' && !depth) {
      out.push(projection.slice(start, i))
      start = i + 1
    }
  }
  out.push(projection.slice(start))
  return out.map((c) => c.trim()).filter(Boolean)
}

// Match source identifiers before SQL executes. Only complete COUNT expressions are exempt.
const PRIVATE =
  /^(?:cid|hn|lname|surname|last_?name|full_?name|patient_?name|person_?name|.*(?:phone|mobile|email|passport|address|addr).*|.*tel(?:_.*)?|fax|road|street|soi|house_?(?:no|number))$/i
export async function leakingColumns(columns, sql, signal) {
  signal?.throwIfAborted()
  return columns.filter((column) => {
    const parsed = scanSql(column)
    if (parsed.error) return true
    const source = parsed.text
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\bas\s+[\s\S]*$/i, '')
      .trim()
    const count = /^count\s*\(/i.exec(source)
    if (count) {
      let depth = 1,
        i = count[0].length
      for (; i < source.length && depth; i++) {
        if (source[i] === '(') depth++
        if (source[i] === ')') depth--
      }
      if (!depth && /^\s*(?:[\w$]+)?\s*$/.test(source.slice(i))) return false
    }
    return (source.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []).some(
      (name) =>
        PRIVATE.test(name) ||
        /^(?:เลขบัตรประชาชน|บ้านเลขที่|นามสกุล|เบอร์โทร|ชื่อสกุล)$/.test(name) ||
        (name.toLowerCase() === 'name' && /\b(?:patient|person|doctor)\b/i.test(sql))
    )
  })
}

const verdict = (leaking) => {
  if (!leaking.length) return null
  console.log(`[guardrail] คอลัมน์ที่รั่ว: ${leaking.join(', ')}`)
  return `คอลัมน์ ${leaking.join(', ')} เป็นข้อมูลส่วนบุคคล (ช่องทางติดต่อ ที่อยู่ หรือเลขประจำตัว) เอาออกจาก SELECT แล้วรันใหม่ ถ้าต้องระบุตัวคนให้ใช้ patient.hos_guid หรือ person.person_id แทน แอปจะเติมชื่อให้เองหลังตอบ`
}

// ก่อนรัน: ดูจาก projection ที่โมเดลเขียนมา ได้ชื่อตรงกับที่มันพิมพ์ บอกให้ตัดได้ตรงตัว
// คำตัดสินไม่ได้ส่งขึ้นจอ — prompt กันคอลัมน์พวกนี้ไว้ก่อนแล้ว ด่านนี้แทบไม่ทำงาน
// ที่ผู้ใช้ควรเห็นคือข้อความที่ agent ตอบกลับมาว่าดึงคอลัมน์นั้นไม่ได้ ซึ่งเห็นอยู่แล้ว
export async function checkLeak(sql, signal) {
  const parsed = scanSql(sql)
  if (parsed.error) return parsed.error
  if (METADATA.test(sql)) return null // SHOW/DESCRIBE คืนโครงสร้าง ไม่ใช่ข้อมูลคน ไม่ต้องจ่ายค่าถาม
  const cols = projections(sql).flatMap(splitColumns)
  return verdict(await leakingColumns(cols, sql, signal))
}

// SELECT * ห้ามทุกกรณี — ตอนก่อนรันมองไม่เห็นว่าจะได้คอลัมน์อะไร ตรวจไม่ได้
// และโมเดลไม่จำเป็นต้องใช้เลย DESCRIBE ชื่อตาราง ก็ได้ชื่อคอลัมน์ครบแล้ว
// DISTINCT / SQL_CALC_FOUND_ROWS ฯลฯ แปะหน้าดาวได้ ต้องลอกออกก่อนถึงจะเห็นว่าเป็นดาว
const MODIFIER =
  /^(?:distinct(?:row)?|all|high_priority|straight_join|sql_(?:small|big|buffer)_result|sql_no_cache|sql_calc_found_rows)\s+/i
const isStar = (col) => {
  let c = col.trim().replace(/`([^`]*)`/g, '$1')
  let prev
  do {
    prev = c
    c = c.replace(MODIFIER, '')
  } while (c !== prev)
  return c === '*' || /^[a-z_$][\w$]*\s*\.\s*\*$/i.test(c)
}
const STAR_ERROR =
  'ห้ามใช้ SELECT * ให้ DESCRIBE ชื่อตาราง ดูชื่อคอลัมน์ก่อน แล้ว SELECT เฉพาะคอลัมน์ที่ต้องใช้จริง'

// ponytail: กัน write ด้วย regex เท่านั้น ของจริงควรต่อด้วย DB user ที่มีแค่ SELECT + CREATE TEMPORARY
export function checkSql(sql) {
  const parsed = scanSql(sql)
  if (parsed.error) return parsed.error
  const s = sql.trim().replace(/;+\s*$/, '')
  if (!s) return 'ไม่มีคำสั่ง'
  if (s.includes(';'))
    return 'ส่งได้ทีละคำสั่งเดียว — temp table อยู่ข้าม call ได้อยู่แล้ว ไม่ต้องรวมเป็นชุด'
  if (READ.test(s) || TMP.test(s))
    // EXPLAIN SELECT * ปล่อยได้ คืนแผนการรัน ไม่ใช่ข้อมูล / ที่เหลือเป็นหน้าที่ของ checkLeak
    return !METADATA.test(s) && projections(s).flatMap(splitColumns).some(isStar)
      ? STAR_ERROR
      : null
  return 'อนุญาตเฉพาะ SELECT/SHOW/DESCRIBE/EXPLAIN และตารางชั่วคราวที่ชื่อขึ้นต้นด้วย tmp_ ถ้าจะแก้ข้อมูลจริงต้องให้ผู้ใช้สั่งเอง'
}

const LIMITS = [
  // MySQL กับ MariaDB ใช้ตัวแปรคนละชื่อ ตั้งทั้งคู่ ตัวที่ไม่มีก็ข้ามไป
  `SET SESSION max_execution_time = ${TIMEOUT_SEC * 1000}`,
  `SET SESSION max_statement_time = ${TIMEOUT_SEC}`
]

// คำสั่งที่แตะ tmp_ ต้องวิ่งบน connection เดิมเสมอ (temp table ผูกกับ session)
// ที่เหลือหยิบจาก pool ได้ จึงรันพร้อมกันหลาย query ในรอบเดียวได้
export function openSql(config, { driver = mysql } = {}) {
  let conn = null
  let pool = null

  const connect = async () => {
    if (conn) return conn
    conn = await driver.createConnection({ ...config, dateStrings: true, supportBigNumbers: true })
    for (const s of LIMITS) await conn.query(s).catch(() => {})
    return conn
  }

  const getPool = () => {
    if (!pool) {
      pool = driver.createPool({
        ...config,
        dateStrings: true,
        supportBigNumbers: true,
        connectionLimit: 4
      })
      pool.on('connection', (c) => LIMITS.forEach((s) => c.query(s, () => {})))
    }
    return pool
  }

  return {
    // Internal post-response lookup only; never registered as an agent tool.
    async personDetails(by, guids, signal) {
      const select = PERSON_LOOKUP[by]
      signal?.throwIfAborted()
      const ids = [...new Set(guids.filter((id) => String(id ?? '').trim()))]
      if (!select || !ids.length) return []
      const c = await getPool().getConnection()
      const onAbort = () => c.destroy()
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      try {
        signal?.throwIfAborted()
        const rows = []
        for (let start = 0; start < ids.length; start += MAX_ROWS) {
          signal?.throwIfAborted()
          const batch = ids.slice(start, start + MAX_ROWS)
          const [found] = await c.execute(
            `${select} (${batch.map(() => '?').join(',')})${GROUP_BY[by] ?? ''}`,
            batch
          )
          rows.push(...found)
        }
        return rows
      } finally {
        signal?.removeEventListener('abort', onAbort)
        if (!signal?.aborted) c.release()
      }
    },

    async query(sql, signal, limit = MAX_ROWS) {
      signal?.throwIfAborted()
      const bad = checkSql(sql) || (await checkLeak(sql, signal))
      signal?.throwIfAborted()
      if (bad) return { error: bad }

      const session = isTemp(sql)
      const c = session ? await connect() : await getPool().getConnection()
      const onAbort = () => {
        c.destroy()
        if (session) conn = null
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()

      try {
        signal?.throwIfAborted()
        const [result, fields] = await c.query({ sql, rowsAsArray: true })
        // DDL/DML ไม่มี fields กลับมา
        if (!fields) return { columns: [], rows: [], rowCount: result.affectedRows ?? 0 }

        const columns = fields.map((f) => f.name)
        // Origin comes from MySQL, not aliases or model-supplied SQL text.
        const personIndex = fields.findIndex(
          (field) =>
            (field.orgTable === 'patient' && field.orgName === 'hos_guid') ||
            (field.orgTable === 'person' && field.orgName === 'person_id')
        )
        return {
          columns,
          personKey:
            personIndex < 0 ? null : { index: personIndex, by: fields[personIndex].orgName },
          rows: result.slice(0, limit).map((r) => r.map((v) => (v === null ? null : String(v)))),
          rowCount: result.length,
          truncated: result.length > limit
        }
      } catch (err) {
        if (signal?.aborted) throw err
        if (err.fatal && session) conn = null // connection ตายแล้ว รอบหน้าค่อยต่อใหม่
        return { error: err.message }
      } finally {
        signal?.removeEventListener('abort', onAbort)
        if (!session && !signal?.aborted) c.release()
      }
    },

    close: async () => {
      await conn?.end().catch(() => {})
      await pool?.end().catch(() => {})
      conn = null
      pool = null
    }
  }
}

export const sqlTool = {
  name: 'tool_sql',
  description: `รัน SQL กับฐานข้อมูล HOSxP จริง (MySQL/MariaDB) ทีละคำสั่ง
อ่านอย่างเดียว: SELECT/SHOW/DESCRIBE/EXPLAIN/WITH — เขียนได้เฉพาะตารางชั่วคราวชื่อขึ้นต้น tmp_ ซึ่งอยู่ข้าม call ได้
ห้าม SELECT * ทุกกรณี ให้ DESCRIBE ดูชื่อคอลัมน์ก่อนแล้วไล่เลือกเอาเฉพาะที่ใช้
ห้ามเอาค่าของคอลัมน์ข้อมูลส่วนบุคคลออกมาแสดง (cid, hn, lname, ชื่อเต็ม, เบอร์โทร, ที่อยู่, อีเมล, พาสปอร์ต) จากตารางใดก็ตาม — ใช้ใน WHERE/JOIN/GROUP BY และใน COUNT() ได้
ระบุตัวคนด้วย patient.hos_guid หรือ person.person_id แล้วแอปจะเติม hn กับชื่อ-สกุลต่อท้ายให้เองหลังตอบ
คืน {columns, rows, rowCount, truncated} rows เป็น array ของ array เรียงตาม columns ทุกค่าเป็น string หรือ null
ได้ไม่เกิน ${MAX_ROWS} แถว (rowCount คือจำนวนจริง) ถ้าต้องการยอดรวมให้ใช้ COUNT/GROUP BY อย่าไล่นับจาก rows
query ที่ไม่ขึ้นต่อกันให้เรียก tool นี้หลายครั้งในรอบเดียว ระบบรันขนานให้`,
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'คำสั่งเดียว ไม่ต้องมี ; ปิดท้าย เช่น SELECT COUNT(*) AS total FROM patient — ใส่ LIMIT ทุกครั้งที่ไม่ได้ต้องการทั้งตาราง'
      }
    },
    required: ['sql']
  },
  run: (args, signal, { db }) => db.query(args.sql ?? '', signal)
}
