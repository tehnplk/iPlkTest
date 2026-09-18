import mysql from 'mysql2/promise'

const MAX_ROWS = 200
const TIMEOUT_SEC = 60

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

      const session = /\btmp_/i.test(sql)
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

// ต่อฐานข้อมูลใน main เอง โมเดลไม่เห็นรหัสผ่าน (ยังไม่ต่อจริงจนกว่าจะ query ครั้งแรก)
export const db = openSql({
  host: import.meta.env?.MAIN_VITE_DB_HOST || 'localhost',
  port: Number(import.meta.env?.MAIN_VITE_DB_PORT || 3306),
  user: import.meta.env?.MAIN_VITE_DB_USER || '',
  password: import.meta.env?.MAIN_VITE_DB_PASSWORD || '',
  database: import.meta.env?.MAIN_VITE_DB_NAME || ''
})

export const sqlTool = {
  name: 'sql',
  description:
    'รัน SQL กับฐานข้อมูล HOSxP จริง ทีละคำสั่ง (อ่านอย่างเดียว + ตารางชั่วคราว tmp_) connection ค้างไว้ temp table อยู่ข้าม call ได้ คืน columns/rows/rowCount/truncated',
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'คำสั่งเดียว เช่น SELECT COUNT(*) AS total FROM patient' }
    },
    required: ['sql']
  },
  run: (args, signal) => db.query(args.sql ?? '', signal)
}
