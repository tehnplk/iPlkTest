import assert from 'node:assert/strict'
import {
  checkSql,
  openSql,
  tablesSql,
  columnsSql,
  listTool,
  schemaTool
} from '../src/main/tools/sql.mjs'

// อ่านได้
for (const ok of [
  'SELECT 1',
  '  select * from patient limit 10;',
  'SHOW TABLES',
  'DESCRIBE patient',
  'EXPLAIN SELECT * FROM ovst'
]) {
  assert.equal(checkSql(ok), null, ok)
}

// เขียนได้เฉพาะตาราง tmp_
assert.equal(checkSql('CREATE TEMPORARY TABLE tmp_a (id INT)'), null)
assert.equal(checkSql('INSERT INTO tmp_a SELECT hn FROM patient'), null)
assert.equal(checkSql('DROP TABLE IF EXISTS tmp_a'), null)

// เขียนของจริงต้องโดนปฏิเสธ
for (const bad of [
  'UPDATE patient SET sex = 1',
  'DELETE FROM patient',
  'INSERT INTO patient (hn) VALUES (1)',
  'DROP TABLE patient',
  'TRUNCATE TABLE ovst',
  'GRANT ALL ON *.* TO x'
]) {
  assert.ok(checkSql(bad), bad)
}

// หลายคำสั่งต่อกันไม่รับ
assert.ok(checkSql('SELECT 1; SELECT 2'))

// เชื่อมต่อไม่ได้ต้องคืน error ไม่ใช่ throw (ยกเว้นตอน connect ล้มเหลว)
const db = openSql({ host: '127.0.0.1', port: 1, user: 'x', database: 'y' })
await assert.rejects(db.query('SELECT 1'), 'ต่อไม่ได้ควรโยนออกมาให้เห็น')
await db.close()

console.log('sql ok')

// tool สำรวจสร้าง SQL เองจากพารามิเตอร์ ต้องได้คำสั่งที่ checkSql ยอมและชื่อถูกครอบ backtick
assert.equal(tablesSql('lab'), "SHOW TABLES LIKE '%lab%'")
assert.equal(tablesSql(''), 'SHOW TABLES')
assert.equal(columnsSql('patient'), 'SHOW COLUMNS FROM `patient`')
assert.equal(checkSql(tablesSql('lab')), null)
assert.equal(checkSql(columnsSql('patient')), null)

// อักขระนอก a-z 0-9 _ $ ต้องถูกปัดตั้งแต่ชั้น tool ไม่ให้หลุดไปต่อสตริง SQL
for (const bad of ["pat'ient", 'patient; drop', 'ตาราง', 'a b', '%']) {
  assert.match((await schemaTool.run({ table: bad })).error, /ชื่อตารางไม่ถูกต้อง/)
  assert.match((await listTool.run({ keyword: bad })).error, /คำค้นใส่ได้แค่/)
}

console.log('sql tools ok')
