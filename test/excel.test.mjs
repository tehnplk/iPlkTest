import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { rmSync, statSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { writeXlsx } from '../src/main/tools/excel.mjs'

// หัวตารางภาษาไทยต้องรอดไปถึงไฟล์ (agent ตั้ง alias เป็นไทยได้)
const columns = ['รหัสผู้ป่วย', 'ชื่อ-สกุล', 'อายุ (ปี)']
const rows = [
  ['000005977', 'จอมขวัญ', '9'],
  ['000006677', 'ยุพิน', '52'],
  ['000006941', null, '1']
]

const file = await writeXlsx(tmpdir(), 'iplk_test_export', columns, rows)
assert.ok(file.endsWith('iplk_test_export.xlsx'), file)
assert.ok(statSync(file).size > 0)

// อ่านกลับมาต้องได้ข้อความไทยครบ
const book = new ExcelJS.Workbook()
await book.xlsx.readFile(file)
const sheet = book.getWorksheet('data')
assert.deepEqual(sheet.getRow(1).values.slice(1), columns, 'หัวตารางไทยต้องไม่เพี้ยน')
assert.equal(sheet.getRow(2).getCell(2).value, 'จอมขวัญ')
assert.equal(sheet.getRow(3).getCell(2).value, 'ยุพิน')
assert.equal(sheet.rowCount, 4)

// ชื่อไฟล์ที่มีอักขระต้องห้ามของ Windows ต้องถูกแทนที่ ไม่ใช่ทำให้เขียนไฟล์พัง
const odd = await writeXlsx(tmpdir(), 'a/b:c*d?.xlsx', columns, rows)
assert.ok(odd.endsWith('a_b_c_d_.xlsx'), odd)

rmSync(file)
rmSync(odd)
console.log('excel ok')
