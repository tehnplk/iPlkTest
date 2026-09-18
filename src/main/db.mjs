import { PGlite } from '@electric-sql/pglite'

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
    CREATE TABLE IF NOT EXISTS memory (
      text text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  return {
    list: async () =>
      (await pg.query('SELECT id, title, messages FROM conversations ORDER BY updated_at DESC'))
        .rows,

    create: async (title) =>
      (await pg.query('INSERT INTO conversations (title) VALUES ($1) RETURNING id', [title]))
        .rows[0].id,

    save: async ({ id, title, messages }) => {
      await pg.query(
        'UPDATE conversations SET title = $1, messages = $2, updated_at = now() WHERE id = $3',
        [title, JSON.stringify(messages), id]
      )
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
