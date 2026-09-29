// run() ของ tool ผ่าน ctx: ฐาน HOSxP ปลอม + PGlite memory:// — ไม่ต้องมี MySQL/Electron
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sqlTool } from '../src/main/tools/sql.mjs'
import { chartTool } from '../src/main/tools/chart.mjs'
import { excelTool } from '../src/main/tools/excel.mjs'
import { memoryTool } from '../src/main/tools/memory.mjs'
import { openDb } from '../src/main/db.mjs'

const queries = []
const db = {
  query: async (sql, _signal, limit) => {
    queries.push({ sql, limit })
    if (/boom/.test(sql)) return { error: 'blocked' }
    return {
      columns: ['hos_guid', 'n'],
      personKey: { index: 0, by: 'hos_guid' },
      rows: [
        ['g1', '3'],
        ['g2', '5']
      ],
      rowCount: 2,
      truncated: false
    }
  },
  personDetails: async () => [{ id: 'g1', cid: 'x', hn: '1', pname: 'นาย', fname: 'ก', lname: 'ข' }]
}

assert.equal((await sqlTool.run({ sql: 'SELECT 1' }, undefined, { db })).rowCount, 2)
assert.deepEqual(await chartTool.run({ sql: 'boom', title: 't' }, undefined, { db }), {
  error: 'blocked'
})
assert.ok((await chartTool.run({ sql: 'SELECT x', title: 't' }, undefined, { db })).chart)

// Excel: ไฟล์ได้ชื่อ-สกุลที่เติม แต่ผลที่ส่งกลับให้โมเดลไม่มีคอลัมน์ที่เติม
const dir = await mkdtemp(join(tmpdir(), 'iplk-tool-'))
try {
  const out = await excelTool.run({ sql: 'SELECT hos_guid', filename: 'x' }, undefined, {
    db,
    downloadsDir: dir
  })
  assert.ok(out.file.startsWith(dir))
  assert.deepEqual(out.columns, ['hos_guid', 'n'])
  assert.ok(out.added_columns.includes('lname'))
} finally {
  await rm(dir, { recursive: true, force: true })
}

// memory: จำ ค้น ลืม บน PGlite memory://
const pg = await openDb('memory://')
const store = async () => pg
assert.equal(
  (await memoryTool.run({ action: 'add', text: 'คลินิกเบาหวาน = 001' }, undefined, { store }))
    .saved,
  'คลินิกเบาหวาน = 001'
)
assert.deepEqual(
  (await memoryTool.run({ action: 'search', text: 'เบาหวาน' }, undefined, { store })).found,
  ['คลินิกเบาหวาน = 001']
)
assert.ok(
  (await memoryTool.run({ action: 'forget', text: 'เบาหวาน' }, undefined, { store })).forgot
)
await pg.close()
console.log('tool run via ctx ok')
