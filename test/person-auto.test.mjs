import assert from 'node:assert/strict'
import { openSql } from '../src/main/tools/sql.mjs'
import { appendPersonDetails } from '../src/main/person-details.mjs'
import { toModelMessages } from '../src/main/conversation-memory.mjs'

let fields = [{ name: 'person_key', orgTable: 'patient', orgName: 'hos_guid' }]
const lookups = []
const connection = {
  async query() {
    return [[['KEY-1']], fields]
  },
  async execute(sql, ids) {
    lookups.push({ sql, ids })
    return [
      [
        {
          id: 'KEY-1',
          cid: 'synthetic-cid',
          hn: 'synthetic-hn',
          pname: 'นาย',
          fname: 'ทดสอบ',
          lname: 'อัตโนมัติ'
        }
      ]
    ]
  },
  release() {},
  destroy() {}
}
const db = openSql(
  {},
  {
    driver: {
      createPool: () => ({
        on() {},
        async getConnection() {
          return connection
        },
        async end() {}
      })
    }
  }
)
const sql =
  "SELECT p.hos_guid AS person_key FROM ovst o JOIN patient p ON p.hn = o.hn WHERE o.vstdate = '2026-09-21' GROUP BY p.hos_guid;"
const result = await db.query(sql)
const answer = {
  role: 'assistant',
  content: 'รายชื่อ',
  step: { sql, result },
  modelMessages: [{ role: 'tool', content: [{ type: 'tool-result', output: result }] }]
}
const enriched = await appendPersonDetails(answer, db.personDetails)
assert.equal(
  lookups.length,
  1,
  'Normal lookup must run automatically for the database-origin patient key'
)
assert.deepEqual(lookups[0].ids, ['KEY-1'])
assert.ok(enriched.step.result.columns.includes('lname'))
assert.equal(enriched.step.result.rows[0].at(-1), 'อัตโนมัติ')
assert.deepEqual(toModelMessages([enriched]), toModelMessages([answer]))

fields = [{ name: 'hos_guid', orgTable: 'ovst', orgName: 'hos_guid' }]
const visit = await db.query('SELECT hos_guid FROM ovst')
await appendPersonDetails(
  { step: { sql: 'SELECT hos_guid FROM patient', result: visit } },
  db.personDetails
)
assert.equal(lookups.length, 1, 'Database origin must override a misleading SQL string')

fields = [{ name: 'person_key', orgTable: 'person', orgName: 'person_id' }]
const person = await db.query('SELECT person_id AS person_key FROM person')
await appendPersonDetails({ step: { result: person } }, db.personDetails)
assert.equal(lookups.length, 2)
assert.match(lookups[1].sql, /FROM person/)

fields = [{ name: 'hos_guid', orgTable: '', orgName: '' }]
const count = await db.query('SELECT COUNT(*) AS hos_guid FROM patient')
await appendPersonDetails(
  { step: { sql: 'SELECT hos_guid FROM patient', result: count } },
  db.personDetails
)
assert.equal(lookups.length, 2, 'Computed or unknown origins must not trigger person lookup')
await db.close()
console.log('automatic person lookup ok')
