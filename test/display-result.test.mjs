import assert from 'node:assert/strict'
import { selectDisplay, countMismatch } from '../src/main/display-result.mjs'

const step = (id, sql, result, toolName = 'tool_sql') => ({
  toolCallId: id,
  toolName,
  sql,
  input: { sql },
  result
})
const table = (v) => ({ columns: ['n'], rows: [[v]], rowCount: 1 })

// ไม่มีผลที่เข้าเกณฑ์ (error / metadata / memory / web) → ไม่มีช่องผลหลัก
assert.equal(
  selectDisplay([
    step('bad', 'SELECT x', { error: 'boom' }),
    step('meta', 'DESCRIBE patient', table('hn')),
    step('mem', 'tool_memory: add x', { saved: 'x' }, 'tool_memory'),
    step('web', 'tool_web_search: q', { results: [] }, 'tool_web_search')
  ]).step,
  null
)
assert.deepEqual(selectDisplay(), { step: null, mismatch: false })

// ผลวิเคราะห์สถิติเป็น Display result ถ้ารันสำเร็จ
const stats = step('py', 'tool_stat_analysis: x', { stdout: 'mean 5', exitCode: 0, rowCount: 3 })
assert.equal(selectDisplay([step('t', 'SELECT a', table('1')), stats]).step.toolCallId, 'py')
const crashed = { ...stats, toolCallId: 'crash', result: { stdout: '', exitCode: 1 } }
assert.equal(selectDisplay([step('t', 'SELECT a', table('1')), crashed]).step.toolCallId, 't')

// สคริปต์ tmp_ = คำสั่งที่สำเร็จจนถึงผลนี้ ไม่รวมคำสั่งหลังจากนั้น
const tmp = [
  step('c', 'CREATE TEMPORARY TABLE tmp_a (x int)', { columns: [], rows: [] }),
  step('i1', 'INSERT INTO tmp_a VALUES (1)', { error: 'retry' }),
  step('i2', 'INSERT INTO tmp_a VALUES (1)', { columns: [], rows: [] }),
  step('count', 'SELECT COUNT(*) FROM tmp_a', table('1')),
  step('drop', 'DROP TEMPORARY TABLE tmp_a', { columns: [], rows: [] })
]
const picked = selectDisplay(tmp).step
assert.equal(picked.toolCallId, 'count')
assert.equal(
  picked.sql,
  'CREATE TEMPORARY TABLE tmp_a (x int);\n\nINSERT INTO tmp_a VALUES (1);\n\nSELECT COUNT(*) FROM tmp_a'
)
assert.equal(picked.querySql, 'SELECT COUNT(*) FROM tmp_a')
// ผลที่ไม่ใช่ tmp_: sql กับ querySql เป็นคำสั่งเดียวกัน
assert.equal(selectDisplay([step('p', 'SELECT a', table('1'))]).step.sql, 'SELECT a')

// เลือก COUNT ที่ตรงกับตัวเลขในคำตอบ และบอกว่าไม่ตรงเมื่อไม่มีตัวไหนตรง
const people = step('people', 'SELECT COUNT(DISTINCT hn) FROM patient', table('6612'))
const rows = step('rows', 'SELECT COUNT(*) FROM patient', table('6615'))
assert.equal(selectDisplay([people, rows], 'มี 6,612 คน').step.toolCallId, 'people')
assert.equal(selectDisplay([people, rows], 'มี 6,612 คน').mismatch, false)
assert.equal(selectDisplay([people, rows], 'มี 900 คน').step.toolCallId, 'rows')
assert.equal(selectDisplay([people, rows], 'มี 900 คน').mismatch, true)
assert.equal(selectDisplay([people, rows], 'ตามตาราง').mismatch, false)

assert.equal(countMismatch('มี 6,612 คน', people), false)
assert.equal(countMismatch('มี ๖,๖๑๒ คน', people), false)
assert.equal(countMismatch('มี 6,615 คน', people), true)
assert.equal(countMismatch('จำนวนตามตาราง', people), false)
assert.equal(countMismatch('มี 5 คน', step('s', 'SELECT SUM(x) FROM t', table('9'))), false)
console.log('display result ok')
