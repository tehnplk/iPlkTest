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
    }
  }
}
