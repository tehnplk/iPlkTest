import { PGlite } from '@electric-sql/pglite'

// ประวัติแชทเก็บ 30 วัน เกินนั้นลบตอนเปิดแอป
export const KEEP_DAYS = 30

// ponytail: 1 บทสนทนา = 1 แถว, ข้อความเก็บรวมเป็น jsonb — แยกตาราง messages เมื่อต้องค้นหา/แบ่งหน้า
export async function openDb(dataDir) {
  const pg = new PGlite(dataDir)
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id serial PRIMARY KEY,
      title text NOT NULL,
      messages jsonb NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- ห้องที่ผู้ใช้กดเก็บเข้าคลัง ไม่หมดอายุ (ADD COLUMN IF NOT EXISTS = ฐานเก่าก็อัปเองได้)
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS memory (
      text text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  return {
    // id ตัดสินเมื่อ updated_at เท่ากัน — now() คือเวลาเริ่ม transaction คำสั่งติดๆ กันได้ค่าเดียวกัน
    list: async () =>
      (
        await pg.query(
          'SELECT id, title, messages, archived FROM conversations ORDER BY updated_at DESC, id DESC'
        )
      ).rows,

    // เก็บเข้าคลัง / เอาออกจากคลัง — อยู่ในคลังแล้วไม่หมดอายุ
    archive: async (id, on = true) => {
      await pg.query('UPDATE conversations SET archived = $1 WHERE id = $2', [!!on, id])
    },

    create: async (title) =>
      (await pg.query('INSERT INTO conversations (title) VALUES ($1) RETURNING id', [title]))
        .rows[0].id,

    save: async ({ id, title, messages }) => {
      await pg.query(
        'UPDATE conversations SET title = $1, messages = $2, updated_at = now() WHERE id = $3',
        [title, JSON.stringify(messages), id]
      )
    },

    // เก็บกวาดตอนเปิดแอป สองอย่าง:
    //   1. ห้องเปล่า — เปิดแอปทีไรก็สร้างห้องใหม่ ไม่ลบทิ้งจะรกไปเรื่อยๆ
    //   2. ห้องที่ไม่ถูกแตะมาเกิน KEEP_DAYS วัน
    // นับจาก updated_at ไม่ใช่วันที่สร้าง — คุยต่อในห้องเก่าแล้วอายุนับใหม่
    // ห้องในคลัง (archived) ไม่หมดอายุ แต่ถ้าเปล่าก็ยังโดนเก็บกวาด จะได้ไม่มีห้องว่างค้างในคลัง
    // ความจำกลาง (ตาราง memory) ไม่หมดอายุ คนละเรื่องกับประวัติแชท
    purge: async (days = KEEP_DAYS) => {
      const { rows } = await pg.query(
        `DELETE FROM conversations
         WHERE messages = '[]'::jsonb
            OR (NOT archived AND updated_at < now() - ($1 || ' days')::interval)
         RETURNING id`,
        [days]
      )
      return rows.length
    },

    remove: async (id) => {
      await pg.query('DELETE FROM conversations WHERE id = $1', [id])
    },

    // ความจำกลาง ใช้ร่วมกันทุกบทสนทนา แนบเข้า system prompt ทุกครั้ง
    // ponytail: เก็บ 100 บรรทัดล่าสุดพอ ถ้าต้องมากกว่านี้ค่อยทำค้นหาแทนการแนบทั้งก้อน
    memories: async () =>
      (await pg.query('SELECT text FROM memory ORDER BY created_at DESC LIMIT 100')).rows
        .map((r) => r.text)
        .reverse(),

    remember: async (text) => {
      const t = String(text ?? '').trim()
      if (!t) return { error: 'ข้อความว่าง' }
      await pg.query(
        'INSERT INTO memory (text) VALUES ($1) ON CONFLICT (text) DO UPDATE SET created_at = now()',
        [t]
      )
      const [{ n }] = (await pg.query('SELECT COUNT(*)::int AS n FROM memory')).rows
      return { saved: t, total: n }
    },

    forget: async (text) => {
      const t = String(text ?? '').trim()
      if (!t) return { error: 'ต้องบอกว่าจะให้ลืมเรื่องอะไร' }
      const { rows } = await pg.query('DELETE FROM memory WHERE text ILIKE $1 RETURNING text', [
        `%${t}%`
      ])
      return rows.length
        ? { forgot: rows.map((r) => r.text) }
        : { error: `ไม่พบความจำเรื่อง "${t}"` }
    }
  }
}
