import assert from 'node:assert/strict'
import { checkSql, checkLeak, openSql } from '../src/main/tools/sql.mjs'

const queries = [
  'SELECT 1--1 AS safe, cid FROM patient LIMIT 1',
  "SELECT '--' AS note, cid FROM patient LIMIT 1",
  "SELECT '#' AS note, cid FROM patient LIMIT 1",
  "SELECT '/* literal */' AS note, cid FROM patient LIMIT 1",
  "SELECT 'FROM SELECT' AS note, cid FROM patient LIMIT 1",
  'SELECT `from`, cid FROM patient LIMIT 1',
  'SELECT 1 AS `safe,name`, cid FROM patient LIMIT 1',
  'SELECT /* ordinary comment */ cid FROM patient LIMIT 1',
  'SELECT 1 AS safe, -- real comment\n cid FROM patient LIMIT 1'
]
const inspect = async (state, questions) =>
  Object.fromEntries(
    Object.keys(questions).map((key, i) => [
      key,
      { noul: /\bcid\b/i.test(state[`col_${i}`]) ? 0.99 : 0.01 }
    ])
  )
const db = openSql(
  {},
  {
    ask: inspect,
    driver: {
      createPool: () => assert.fail('Blocked projection reached the database'),
      createConnection: () => assert.fail('Blocked projection reached the database')
    }
  }
)
for (const sql of queries) {
  assert.equal(checkSql(sql), null, sql)
  assert.match(await checkLeak(sql, undefined, inspect), /cid/, sql)
  assert.match((await db.query(sql)).error, /cid/, sql)
}
for (const sql of [
  'SELECT /*!50000 cid */ FROM patient LIMIT 1',
  'SELECT /*! cid */ FROM patient LIMIT 1',
  'SELECT /*M!100100 cid */ FROM patient LIMIT 1',
  'EXPLAIN SELECT /*!50000 cid */ FROM patient'
]) {
  assert.match(checkSql(sql), /executable comment/, sql)
  assert.match((await db.query(sql)).error, /executable comment/, sql)
}
for (const sql of ["SELECT 'unterminated", 'SELECT /* unterminated']) assert.ok(checkSql(sql), sql)
assert.match(checkSql('SELECT `p`.* FROM patient p'), /SELECT \*/)
assert.equal(checkSql("SELECT '/*! this is only a string */' AS note"), null)
assert.equal(
  await checkLeak("SELECT '--' AS note, COUNT(DISTINCT hn) FROM patient", undefined, inspect),
  null
)
await db.close()
console.log('sql lexing ok')
