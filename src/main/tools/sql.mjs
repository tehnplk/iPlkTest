import mysql from 'mysql2/promise'

const MAX_ROWS = 200
const TIMEOUT_SEC = 60

// คำสั่งที่แตะ temp table ต้องอยู่ connection เดิม และต้องถูกรวมเป็นสคริปต์เดียวตอนโชว์ให้ผู้ใช้
export const isTemp = (sql) => /\btmp_/i.test(sql ?? '')

const READ = /^\s*(select|show|desc|describe|explain|with|set\s)/i
const TMP =
  /^\s*(create\s+temporary\s+table|insert\s+into\s+`?tmp_|update\s+`?tmp_|delete\s+from\s+`?tmp_|drop\s+(temporary\s+)?table\s+(if\s+exists\s+)?`?tmp_)/i

// ponytail: กัน write ด้วย regex เท่านั้น ของจริงควรต่อด้วย DB user ที่มีแค่ SELECT + CREATE TEMPORARY
export function checkSql(sql) {
  const s = sql.trim().replace(/;+\s*$/, '')
  if (!s) return 'ไม่มีคำสั่ง'
  if (s.includes(';'))
    return 'ส่งได้ทีละคำสั่งเดียว — temp table อยู่ข้าม call ได้อยู่แล้ว ไม่ต้องรวมเป็นชุด'
  if (READ.test(s) || TMP.test(s)) return null
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
    async query(sql, signal, limit = MAX_ROWS) {
      const bad = checkSql(sql)
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

        return {
          columns: fields.map((f) => f.name),
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

// ชื่อตาราง/คำค้นของ HOSxP เป็น ascii ล้วน — กันอักขระอื่นไว้ก็ไม่ต้องหนี quote ให้ยุ่ง
const NAME = /^[A-Za-z0-9_$]+$/

export const tablesSql = (keyword = '') =>
  keyword ? `SHOW TABLES LIKE '%${keyword}%'` : 'SHOW TABLES'
export const columnsSql = (table) => `SHOW COLUMNS FROM \`${table}\``

export const listTool = {
  name: 'list_table_name',
  description: `หาชื่อตารางในฐาน HOSxP ด้วยคำค้น (ฐานนี้มีหลายพันตาราง ห้ามเดาชื่อเอง)
เริ่มจาก tool นี้เสมอก่อนเขียน query จริง เร็วไม่ถึงวินาที เรียกหลายคำค้นพร้อมกันในรอบเดียวได้
ไม่ใส่คำค้น = ได้ทั้งฐาน ซึ่งเกิน ${MAX_ROWS} แถวแน่ๆ ให้ใส่คำค้นเสมอ
ไม่เจอ = โรงพยาบาลนี้ไม่ได้ใช้ตารางนั้น ให้ลองคำอื่น อย่าเดาชื่อแล้ว query ไปเลย`,
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          'คำค้นอังกฤษหรือตัวย่อที่ HOSxP ใช้ เช่น lab, drug, diag, visit, person, opd, ipd, screen (a-z 0-9 _ เท่านั้น)'
      }
    },
    required: ['keyword']
  },
  run: (args, signal) => {
    const kw = (args.keyword ?? '').trim()
    if (kw && !NAME.test(kw))
      return { error: 'คำค้นใส่ได้แค่ a-z 0-9 _ ($) เช่น lab หรือ opd_visit' }
    return db.query(tablesSql(kw), signal)
  }
}

export const schemaTool = {
  name: 'get_table_schema',
  description: `ดูคอลัมน์ทั้งหมดของตารางเดียว (Field/Type/Null/Key/Default/Extra)
ต้องเรียกยืนยันก่อนเขียน query จริงทุกครั้ง อย่าเดาชื่อคอลัมน์
จะ join สองตารางให้เรียก tool นี้ทั้งสองตารางพร้อมกันในรอบเดียว แล้วเลือกคีย์ที่ชื่อตรงกันจริงๆ`,
  parameters: {
    type: 'object',
    properties: {
      table: { type: 'string', description: 'ชื่อตารางเดียว เช่น patient (ได้จาก list_table_name)' }
    },
    required: ['table']
  },
  run: (args, signal) => {
    const t = (args.table ?? '').trim()
    if (!NAME.test(t))
      return { error: 'ชื่อตารางไม่ถูกต้อง ใส่ชื่อเดียวแบบ a-z 0-9 _ เช่น patient' }
    return db.query(columnsSql(t), signal)
  }
}

export const queryTool = {
  name: 'query_data',
  description: `รัน SQL กับฐานข้อมูล HOSxP จริง (MySQL/MariaDB) ทีละคำสั่ง — ใช้ตอนจะดึงข้อมูลจริง
หาชื่อตารางใช้ list_table_name ดูคอลัมน์ใช้ get_table_schema สองอย่างนั้นเร็วกว่ามาก
อ่านอย่างเดียว: SELECT/SHOW/DESCRIBE/EXPLAIN/WITH — เขียนได้เฉพาะตารางชั่วคราวชื่อขึ้นต้น tmp_ ซึ่งอยู่ข้าม call ได้
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
