import assert from 'node:assert/strict'
import { checkSql, openSql } from '../src/main/tools/sql.mjs'

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
