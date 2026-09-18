import { join } from 'path'
import { db } from './sql.mjs'
import ExcelJS from 'exceljs'

// กันไฟล์ใหญ่จนแอปค้าง — เกินนี้ให้ผู้ใช้ซอย query เอง
export const MAX_EXPORT_ROWS = 10000

const safeName = (name) =>
  (name || 'export').replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '') + '.xlsx'

export async function writeXlsx(dir, name, columns, rows) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('data')

  sheet.addRow(columns)
  sheet.getRow(1).font = { bold: true }
  rows.forEach((r) => sheet.addRow(r))
  // ความกว้างพอประมาณจากหัวคอลัมน์ ไม่ต้องวัดทุกเซลล์
  sheet.columns.forEach(
    (c, i) => (c.width = Math.min(40, Math.max(12, String(columns[i]).length + 4)))
  )
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const file = join(dir, safeName(name))
  await book.xlsx.writeFile(file)
  return file
}

export const excelTool = {
  name: 'export_excel',
  description:
    'รัน SELECT แล้วเซฟผลเป็นไฟล์ Excel (.xlsx) ในโฟลเดอร์ Downloads ใช้เมื่อผู้ใช้ขอไฟล์ หรือผลลัพธ์ยาวเกินกว่าจะดูบนจอ',
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SELECT ที่ต้องการ export (ไม่ต้องใส่ LIMIT)' },
      filename: { type: 'string', description: 'ชื่อไฟล์ภาษาอังกฤษ เช่น dm_screening' }
    },
    required: ['sql', 'filename']
  },
  run: async (args, signal, { downloadsDir }) => {
    const res = await db.query(args.sql ?? '', signal, MAX_EXPORT_ROWS)
    if (res.error || !res.columns.length) return res
    const file = await writeXlsx(downloadsDir, args.filename, res.columns, res.rows)
    // ส่งกลับแค่ 20 แถวให้โมเดลพอเห็นหน้าตา ที่เหลืออยู่ในไฟล์
    return { ...res, rows: res.rows.slice(0, 20), truncated: res.rowCount > 20, file }
  }
}
