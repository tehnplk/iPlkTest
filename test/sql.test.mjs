import assert from 'node:assert/strict'
import { checkLeak, checkSql, openSql } from '../src/main/tools/sql.mjs'

// อ่านได้
for (const ok of [
  'SELECT 1',
  'SELECT hos_guid, fname FROM patient LIMIT 10;',
  'SELECT COUNT(*) AS total FROM patient',
  "SELECT 'cid, lname จาก patient' AS note",
  'SHOW TABLES',
  'DESCRIBE patient',
  'EXPLAIN SELECT * FROM ovst'
]) {
  assert.equal(checkSql(ok), null, ok)
}

// เขียนได้เฉพาะตาราง tmp_
assert.equal(checkSql('CREATE TEMPORARY TABLE tmp_a (id INT)'), null)
assert.equal(checkSql('INSERT INTO tmp_a SELECT hos_guid FROM patient'), null)
assert.equal(checkSql('DROP TABLE IF EXISTS tmp_a'), null)

for (const ok of [
  'SELECT cid FROM person LIMIT 1',
  'SELECT hn, lname FROM patient LIMIT 1',
  'SELECT hometel FROM patient LIMIT 1',
  'CREATE TEMPORARY TABLE tmp_x AS SELECT cid FROM vn_stat'
])
  assert.equal(checkSql(ok), null, ok)

for (const sql of [
  'SELECT passport_no FROM patient',
  'SELECT cid AS safe FROM patient',
  'SELECT COUNT(hn) + MAX(cid) FROM patient',
  'WITH x AS (SELECT cid AS safe FROM patient) SELECT safe FROM x',
  'SELECT `cid` FROM patient',
  'SELECT CONCAT(fname, lname) FROM patient'
])
  assert.ok(await checkLeak(sql), sql)
for (const sql of [
  'SELECT COUNT(DISTINCT hn) AS people FROM patient',
  'SELECT hos_guid, sex, age FROM patient',
  'SHOW TABLES'
])
  assert.equal(await checkLeak(sql), null, sql)
for (const star of [
  'SELECT * FROM patient LIMIT 1',
  'SELECT * FROM icd101',
  'SELECT p.* FROM person p',
  'SELECT hos_guid, p.* FROM patient p',
  'SELECT SQL_CALC_FOUND_ROWS * FROM patient',
  'CREATE TEMPORARY TABLE tmp_a AS SELECT * FROM patient'
])
  assert.match(checkSql(star), /ห้ามใช้ SELECT \*/, star)

// COUNT(*) กับ EXPLAIN ไม่ใช่การดึงข้อมูลออกมา ต้องไม่โดนลูกหลง
for (const ok of [
  'SELECT COUNT(*) AS total FROM patient',
  'SELECT COUNT( * ) AS total FROM patient',
  'SELECT vstdate, COUNT(*) AS n FROM ovst GROUP BY vstdate',
  'EXPLAIN SELECT * FROM ovst'
])
  assert.equal(checkSql(ok), null, ok)

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

const db = openSql({ host: '127.0.0.1', port: 1, user: 'x', database: 'y' })
assert.match((await db.query('SELECT cid FROM patient')).error, /cid/)
await assert.rejects(db.query('SELECT sex FROM patient'))
await assert.rejects(db.query('SHOW TABLES'), 'ต่อไม่ได้ควรโยนออกมาให้เห็น')
await db.close()

console.log('sql ok')
