import { askJev } from '../jev.mjs'
import mysql from 'mysql2/promise'

const MAX_ROWS = 200
const TIMEOUT_SEC = 60

// คำสั่งที่แตะ temp table ต้องอยู่ connection เดิม และต้องถูกรวมเป็นสคริปต์เดียวตอนโชว์ให้ผู้ใช้
export const isTemp = (sql) => /\btmp_/i.test(sql ?? '')

const READ = /^\s*(select|show|desc|describe|explain|with|set\s)/i
const TMP =
  /^\s*(create\s+temporary\s+table|insert\s+into\s+`?tmp_|update\s+`?tmp_|delete\s+from\s+`?tmp_|drop\s+(temporary\s+)?table\s+(if\s+exists\s+)?`?tmp_)/i

// ตัดส่วน SELECT...FROM ของทุก select ออกมา — FROM ในวงเล็บ (TRIM(x FROM y)) ไม่นับเป็นจุดจบ projection
// ดูแค่ projection เพราะ WHERE/JOIN ON/GROUP BY ไม่ได้ส่งค่าออกมา จะใช้ cid เชื่อมตารางก็ได้
function projections(sql) {
  const low = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(--|#)[^\r\n]*/g, ' ')
    .replace(/'(?:''|\\.|[^'])*'/g, "''")
    .replace(/"(?:""|\\.|[^"])*"/g, '""')
    .replace(/`([^`]*)`/g, '$1')
    .toLowerCase()
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
    out.push(low.slice(re.lastIndex, i))
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

// ข้อมูลส่วนบุคคล: jev ตัดสินคนเดียว ไม่มีลิสต์ชื่อคอลัมน์ตายตัว เพราะไล่ไม่มีวันครบ —
// ที่อยู่อย่างเดียวมีชื่อคอลัมน์ 28 แบบ (addrpart, addr_soi, pat_addr, work_addr, old_addr ...)
// phone 12, email 7 ให้ jev อ่าน "ทีละคอลัมน์" แล้วบอกกลับว่าคอลัมน์ไหนรั่ว agent จะได้ตัดถูกตัว
//
// วัดกับ 31 คอลัมน์ที่ลิสต์ตายตัวเคยกันไว้ (cid, hn, lname, เบอร์โทร ทั้งแบบมี prefix ตาราง
// เปลี่ยนชื่อด้วย AS ห่อ MAX/GROUP_CONCAT/SUBSTRING/CONCAT) ถูก 31/31 และไม่บล็อกเกินสักตัว
// (COUNT(DISTINCT hn), fname, pname, birthday, hos_guid, person_id ผ่านหมด) — npm run bench:persona
//
// ถามรายคอลัมน์ ไม่ถามรวมทั้งคำสั่ง เพราะถามรวมแล้วเป็นการตัดสินเชิงนโยบาย วัดแล้วสลับขั้ว
// (pname+fname ได้ 0.65 สูงกว่าเคสที่อยู่ 0.56)
//
// วัดจริงรายคอลัมน์: road/passport_no 0.96, tel/email 0.95, addr_soi 0.94, บ้านเลขที่ 0.90,
// CONCAT ชื่อ-สกุล 0.90, address 0.84, patient_name 0.74, person_name 0.57
// ที่ต้องผ่าน: pname 0.35, v.moo 0.08, hos_guid/fname/person_id/birthday/sex/age <0.08
// ช่องว่าง 0.35 -> 0.57 ตั้งเพดานตรงกลาง (~400ms/คำสั่ง, ~$0.00002)
const JEV_BLOCK = 0.46
const METADATA = /^\s*(show|desc|describe|explain)\b/i
const MAX_ASK = 20
const LEAK_CRITERIA = {
  true: 'Judge the source expression, ignoring any AS alias that renames or disguises it. It is true when the output carries a way to reach one specific person at home or to officially identify them. In this Thai hospital schema that means: cid (the 13-digit Thai citizen ID, always identifying, whatever table it sits in), hn (the hospital number), the family name or any column holding a whole person name however it happens to be spelled, passport number, phone, mobile, fax, email, and the street part of a home address (house number, lane, soi, road, street, or a full address line). GROUP_CONCAT, MIN, MAX, SUBSTRING, CONCAT and similar still hand back the stored values themselves, so they are true whenever they read such a column',
  false:
    'The output carries none of that. COUNT() is the only aggregate that returns a pure number rather than stored values, so COUNT of anything is false. Also false: dates, ages, sex, diagnosis or drug codes, hospital department, an area grouping used for statistics such as village number, subdistrict or province, and opaque keys such as hos_guid, person_id, vn or an. A title prefix (pname) and a given name (fname) are each false on their own, and stay false even when the same statement selects both, because without the family name they do not single out one person'
}

// แยก projection เป็นรายคอลัมน์ที่ระดับบนสุด (คอมมาในวงเล็บของ CONCAT/COUNT ไม่นับ)
function splitColumns(projection) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < projection.length; i++) {
    if (projection[i] === '(') depth++
    else if (projection[i] === ')') depth--
    else if (projection[i] === ',' && !depth) {
      out.push(projection.slice(start, i))
      start = i + 1
    }
  }
  out.push(projection.slice(start))
  return out.map((c) => c.trim()).filter(Boolean)
}

// คืนชื่อคอลัมน์ที่รั่ว, [] = ไม่มีอะไรรั่ว, null = ตัดสินไม่ได้ (jev ล่ม/ไม่มีคีย์/ช้า)
// null กับ [] ต้องแยกกันให้ชัด เพราะ jev เป็นด่านเดียวที่เหลือแล้ว ตัดสินไม่ได้ต้องไม่แปลว่าปลอดภัย
//
// ต้องส่ง SQL ไปด้วยเสมอ ไม่งั้น jev เห็นชื่อคอลัมน์ลอยๆ แล้วเดาผิด (คอลัมน์ชื่อ name
// ในตาราง icd101 คือชื่อโรค แต่ถ้าไม่มี context มันจะตีเป็นชื่อ-สกุลคน)
export async function leakingColumns(columns, sql, signal, ask = askJev) {
  const list = columns.filter(Boolean)
  if (!list.length) return []
  const state = { sql: String(sql ?? '').replace(/\s+/g, ' ') }
  const questions = {}
  list.slice(0, MAX_ASK).forEach((c, i) => {
    state[`col_${i}`] = c
    questions[`c${i}`] = {
      type: 'noul',
      instructions: `col_${i}: this column of the SELECT result of the statement in sql`,
      criteria: LEAK_CRITERIA
    }
  })
  const answers = await ask(state, questions, signal)
  if (!answers) return null
  return list.filter((_, i) => (answers[`c${i}`]?.noul ?? 0) >= JEV_BLOCK)
}

// jev เป็นด่านเดียวที่กันข้อมูลส่วนบุคคล ถามไม่ได้ก็ต้องไม่รัน ไม่ใช่ปล่อยผ่านเงียบๆ
// (ตอนยังมี regex เป็นพื้น ปล่อยผ่านได้ พอถอด regex ออกแล้วปล่อยผ่าน = ไม่เหลือด่านอะไรเลย)
const UNAVAILABLE =
  'ตรวจข้อมูลส่วนบุคคลไม่ได้ตอนนี้ (ตัวตรวจไม่ตอบ) เลยยังไม่รัน SQL ให้ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้บอกผู้ใช้ว่าระบบตรวจขัดข้อง'

const verdict = (leaking) => {
  if (leaking === null) {
    console.log('[jev] ตัดสินไม่ได้ ไม่รัน SQL')
    return UNAVAILABLE
  }
  if (!leaking.length) return null
  console.log(`[jev] คอลัมน์ที่รั่ว: ${leaking.join(', ')}`)
  return `คอลัมน์ ${leaking.join(', ')} เป็นข้อมูลส่วนบุคคล (ช่องทางติดต่อ ที่อยู่ หรือเลขประจำตัว) เอาออกจาก SELECT แล้วรันใหม่ ถ้าต้องระบุตัวคนให้ใช้ patient.hos_guid หรือ person.person_id แทน แอปจะเติมชื่อให้เองหลังตอบ`
}

// ก่อนรัน: ดูจาก projection ที่โมเดลเขียนมา ได้ชื่อตรงกับที่มันพิมพ์ บอกให้ตัดได้ตรงตัว
// คำตัดสินไม่ได้ส่งขึ้นจอ — prompt กันคอลัมน์พวกนี้ไว้ก่อนแล้ว ด่านนี้แทบไม่ทำงาน
// ที่ผู้ใช้ควรเห็นคือข้อความที่ agent ตอบกลับมาว่าดึงคอลัมน์นั้นไม่ได้ ซึ่งเห็นอยู่แล้ว
export async function checkLeak(sql, signal, ask = askJev) {
  if (METADATA.test(sql)) return null // SHOW/DESCRIBE คืนโครงสร้าง ไม่ใช่ข้อมูลคน ไม่ต้องจ่ายค่าถาม
  const cols = projections(sql).flatMap(splitColumns)
  return verdict(await leakingColumns(cols, sql, signal, ask))
}

// SELECT * ห้ามทุกกรณี — ตอนก่อนรันมองไม่เห็นว่าจะได้คอลัมน์อะไร ตรวจไม่ได้
// และโมเดลไม่จำเป็นต้องใช้เลย DESCRIBE ชื่อตาราง ก็ได้ชื่อคอลัมน์ครบแล้ว
// DISTINCT / SQL_CALC_FOUND_ROWS ฯลฯ แปะหน้าดาวได้ ต้องลอกออกก่อนถึงจะเห็นว่าเป็นดาว
const MODIFIER =
  /^(?:distinct(?:row)?|all|high_priority|straight_join|sql_(?:small|big|buffer)_result|sql_no_cache|sql_calc_found_rows)\s+/i
const isStar = (col) => {
  let c = col.trim()
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
export function openSql(config) {
  let conn = null
  let pool = null

  const connect = async () => {
    if (conn) return conn
    conn = await mysql.createConnection({ ...config, dateStrings: true, supportBigNumbers: true })
    for (const s of LIMITS) await conn.query(s).catch(() => {})
    return conn
  }

  const getPool = () => {
    if (!pool) {
      pool = mysql.createPool({
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
      const bad = checkSql(sql) || (await checkLeak(sql, signal))
      if (bad) return { error: bad }

      const session = isTemp(sql)
      const c = session ? await connect() : await getPool().getConnection()
      const onAbort = () => {
        c.destroy()
        if (session) conn = null
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        const [result, fields] = await c.query({ sql, rowsAsArray: true })
        // DDL/DML ไม่มี fields กลับมา
        if (!fields) return { columns: [], rows: [], rowCount: result.affectedRows ?? 0 }

        const columns = fields.map((f) => f.name)
        return {
          columns,
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

// ค่ามาจาก .env ที่ env.mjs โหลดเข้า process.env ตอนเปิดแอป
const env = (key, fallback = '') => process.env[key] ?? fallback

// ต่อฐานข้อมูลใน main เอง โมเดลไม่เห็นรหัสผ่าน (ยังไม่ต่อจริงจนกว่าจะ query ครั้งแรก)
export const db = openSql({
  host: env('DB_HOST', 'localhost'),
  port: Number(env('DB_PORT', 3306)),
  user: env('DB_USER'),
  password: env('DB_PASSWORD'),
  database: env('DB_NAME')
})

export const sqlTool = {
  name: 'sql',
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
  run: (args, signal) => db.query(args.sql ?? '', signal)
}
