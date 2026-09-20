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

// checkSql กันแค่การเขียนของจริงกับหลายคำสั่งต่อกัน — ข้อมูลส่วนบุคคลเป็นหน้าที่ jev ทั้งหมด
// (ดู npm run bench:persona ซึ่งยิง jev จริง 42 เคส) ที่นี่เลยเช็คแค่ว่าไม่บล็อกเกินหน้าที่
for (const ok of [
  'SELECT cid FROM person LIMIT 1',
  'SELECT hn, lname FROM patient LIMIT 1',
  'SELECT hometel FROM patient LIMIT 1',
  'CREATE TEMPORARY TABLE tmp_x AS SELECT cid FROM vn_stat'
])
  assert.equal(checkSql(ok), null, ok)

// ด่านสาม: jev ให้คะแนนรายคอลัมน์ — ยิง jev จริงไม่ได้ในเทสต์ เลยฉีด asker ปลอมเข้าไป
// asker ปลอมให้คะแนนสูงเฉพาะคอลัมน์ที่มีคำว่า addr/tel/mail/passport
const jev = async (state) =>
  Object.fromEntries(
    Object.entries(state).map(([k, v]) => [
      k.replace('col_', 'c'),
      { noul: /addr|tel|mail|passport|road/i.test(v) ? 0.9 : 0.05 }
    ])
  )
const leak = await checkLeak(
  'SELECT p.hos_guid, p.addrpart AS `บ้านเลขที่`, p.road, p.sex FROM patient p LIMIT 5',
  null,
  jev
)
assert.match(leak, /บ้านเลขที่/, 'ต้องบอกชื่อคอลัมน์ที่รั่วกลับไปให้ agent ตัดถูกตัว')
assert.match(leak, /road/)
assert.doesNotMatch(leak, /p.hos_guid/, 'คีย์ที่อนุญาตต้องไม่ถูกฟ้อง')
assert.equal(await checkLeak('SELECT hos_guid, sex, age FROM patient', null, jev), null)

// jev ล่ม/ไม่มีคีย์ = ตัดสินไม่ได้ ต้องไม่รัน เพราะไม่เหลือด่านอื่นกันข้อมูลส่วนบุคคลแล้ว
assert.match(
  await checkLeak('SELECT passport_no FROM patient', null, async () => null),
  /ตรวจข้อมูลส่วนบุคคลไม่ได้/
)
// Missing scores are incomplete decisions, not permission to execute.
assert.match(
  await checkLeak('SELECT sex FROM patient', null, async () => ({})),
  /ตรวจข้อมูลส่วนบุคคลไม่ได้/
)
// แต่ SHOW/DESCRIBE ไม่ได้ถาม jev อยู่แล้ว ล่มก็ยังรันได้
assert.equal(await checkLeak('SHOW TABLES', null, async () => null), null)
// SHOW/DESCRIBE ไม่ต้องจ่ายค่าถาม
assert.equal(
  await checkLeak('SHOW COLUMNS FROM patient', null, () => assert.fail('ไม่ควรถาม jev')),
  null
)
// SELECT * ห้ามทุกกรณี ตัดตั้งแต่ checkSql ไม่ต้องเปลือง jev — DESCRIBE เอาชื่อคอลัมน์ได้อยู่แล้ว
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
// ไม่มี OPENROUTER_API_KEY ในเทสต์ = jev ตัดสินไม่ได้ ต้องไม่ยอมรันตั้งแต่ยังไม่ต่อฐาน
assert.match((await db.query('SELECT sex FROM patient')).error, /ตรวจข้อมูลส่วนบุคคลไม่ได้/)
// SHOW ไม่ผ่าน jev เลยไปถึงขั้นต่อฐานจริง ต่อไม่ได้ต้องโยนออกมาให้เห็น ไม่ใช่กลืนเงียบ
await assert.rejects(db.query('SHOW TABLES'), 'ต่อไม่ได้ควรโยนออกมาให้เห็น')
await db.close()

console.log('sql ok')
