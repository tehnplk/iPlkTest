import { db } from './sql.mjs'

// กราฟที่มีจุดเยอะกว่านี้อ่านไม่รู้เรื่อง ให้ไป GROUP BY มาใหม่
const MAX_POINTS = 50
// เกินนี้สีเริ่มวน ก้อนที่เหลือยุบเป็น "อื่นๆ" (วงกลมเท่านั้น แท่ง/เส้นยาวกว่านี้ได้)
const MAX_SLICES = 8
const TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'pyramid']
// radar อ่านออกแค่ตอนแกนไม่เยอะ เกินนี้เส้นทับกันจนมั่ว
const MAX_AXES = 12

const num = (v) => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v))

// คอลัมน์แรก = ป้าย ที่เหลือ = ชุดข้อมูลตัวเลข — คืน {error} พร้อมวิธีแก้ ถ้ารูปทรงไม่เข้ากับกราฟ
export function toChart({ columns, rows }, type = 'bar', title = '') {
  if (!TYPES.includes(type)) return { error: `type ต้องเป็น ${TYPES.join('/')} เท่านั้น` }
  if (columns.length < 2)
    return { error: 'query ต้องมีอย่างน้อย 2 คอลัมน์: คอลัมน์แรกเป็นป้ายกำกับ ที่เหลือเป็นตัวเลข' }
  if (!rows.length) return { error: 'query ไม่ได้ข้อมูลกลับมา ไม่มีอะไรให้วาด' }
  if (rows.length > MAX_POINTS)
    return {
      error: `ได้ ${rows.length} จุด เกิน ${MAX_POINTS} ที่กราฟอ่านรู้เรื่อง ให้ GROUP BY หยาบขึ้นหรือใส่ LIMIT`
    }

  // ปิรามิดประชากร: ต้องมีสองฝั่งพอดี (กลุ่มอายุ, ชาย, หญิง) ไม่งั้นมันคือกราฟแท่งธรรมดา
  if (type === 'pyramid' && columns.length !== 3)
    return {
      error:
        'pyramid ต้องมี 3 คอลัมน์พอดี: กลุ่มอายุ, จำนวนชาย, จำนวนหญิง (เรียงจากกลุ่มอายุน้อยไปมาก)'
    }

  if (type === 'radar' && rows.length > MAX_AXES)
    return {
      error: `radar มีได้ไม่เกิน ${MAX_AXES} แกน (ได้มา ${rows.length}) ให้ลดกลุ่มลง หรือใช้ bar แทน`
    }

  const pie = type === 'pie' || type === 'doughnut'
  // วงกลมมีค่าได้ชุดเดียว ถ้าเผลอส่งมาหลายคอลัมน์ให้ใช้คอลัมน์แรกพอ
  const valueCols = pie ? columns.slice(1, 2) : columns.slice(1)

  const datasets = valueCols.map((name, i) => ({
    label: name,
    data: rows.map((r) => num(r[i + 1]))
  }))
  const bad = datasets.find((d) => d.data.every((v) => v === null))
  if (bad)
    return {
      error: `คอลัมน์ ${bad.label} ไม่ใช่ตัวเลข กราฟใช้ไม่ได้ ให้ SELECT ค่าที่เป็นตัวเลขมา`
    }

  // ฝั่งซ้ายของปิรามิดวาดด้วยค่าติดลบ (จอกลับเครื่องหมายตอนโชว์ตัวเลขให้เอง)
  if (type === 'pyramid')
    datasets[0].data = datasets[0].data.map((v) => (v === null ? null : -Math.abs(v)))

  let labels = rows.map((r) => String(r[0] ?? 'ไม่ระบุ'))

  // ชิ้นเล็กๆ เยอะๆ ในวงกลมอ่านไม่ออกและสีไม่พอ ยุบเป็นก้อนเดียว
  if (pie && labels.length > MAX_SLICES) {
    const order = labels
      .map((l, i) => ({ l, v: datasets[0].data[i] ?? 0 }))
      .sort((a, b) => b.v - a.v)
    const top = order.slice(0, MAX_SLICES - 1)
    const rest = order.slice(MAX_SLICES - 1).reduce((s, o) => s + o.v, 0)
    labels = [...top.map((o) => o.l), `อื่นๆ (${order.length - top.length} รายการ)`]
    datasets[0].data = [...top.map((o) => o.v), rest]
  }

  return { chart: { type, title, labels, datasets }, points: labels.length }
}

export const chartTool = {
  name: 'render_chart',
  description: `วาดกราฟจากผล SELECT แล้วแสดงในหน้าจอแชทให้ผู้ใช้เห็นทันที (Chart.js)
ใช้เมื่อผู้ใช้ขอกราฟ/แผนภูมิ หรือเมื่อตัวเลขที่เทียบกันหลายก้อนดูเป็นกราฟแล้วเข้าใจง่ายกว่าตาราง
คอลัมน์แรกของ query คือป้ายกำกับ (เดือน/เพศ/แผนก) คอลัมน์ถัดไปคือค่าตัวเลข ใส่ได้หลายคอลัมน์ = หลายชุดข้อมูล (ยกเว้น pie/doughnut ใช้คอลัมน์เดียว)
เลือก type: bar เทียบก้อนต่อก้อน, line ดูแนวโน้มตามเวลา, pie/doughnut ดูสัดส่วนของทั้งหมด, radar เทียบหลายด้านพร้อมกัน (ไม่เกิน ${MAX_AXES} แกน)
pyramid = ปิรามิดประชากร ต้อง SELECT 3 คอลัมน์พอดี (กลุ่มอายุ, ชาย, หญิง) เรียงกลุ่มอายุน้อยไปมาก ระบบวางชายซ้าย หญิงขวาให้เอง
ไม่เกิน ${MAX_POINTS} จุด คืน {chart, points} — จอวาดให้แล้ว ห้ามพิมพ์ตัวเลขซ้ำในคำตอบ บอกแค่ว่ากราฟบอกอะไร`,
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'SELECT ที่ให้ข้อมูลกราฟ เรียงลำดับมาให้เรียบร้อย เช่น SELECT MONTH(vstdate) AS เดือน, COUNT(*) AS จำนวน FROM ovst GROUP BY 1 ORDER BY 1'
      },
      type: { type: 'string', enum: TYPES, default: 'bar', description: 'ไม่ใส่ = bar' },
      title: { type: 'string', description: 'หัวกราฟภาษาไทยสั้นๆ เช่น ผู้ป่วยนอกรายเดือน ปี 2568' }
    },
    required: ['sql', 'title']
  },
  run: async (args, signal) => {
    const res = await db.query(args.sql ?? '', signal, MAX_POINTS + 1)
    if (res.error) return res
    return toChart(res, args.type ?? 'bar', args.title ?? '')
  }
}
