import assert from 'node:assert/strict'
import { toChart } from '../src/main/tools/chart.mjs'

const bar = toChart(
  {
    columns: ['เพศ', 'จำนวน'],
    rows: [
      ['หญิง', '3493'],
      ['ชาย', '3118']
    ]
  },
  'bar',
  'ผู้ป่วยแยกตามเพศ'
)
assert.deepEqual(bar.chart.labels, ['หญิง', 'ชาย'])
assert.deepEqual(bar.chart.datasets, [{ label: 'จำนวน', data: [3493, 3118] }])
assert.equal(bar.chart.title, 'ผู้ป่วยแยกตามเพศ')

// หลายคอลัมน์ = หลายชุดข้อมูล
const multi = toChart(
  {
    columns: ['เดือน', 'ชาย', 'หญิง'],
    rows: [
      ['ม.ค.', '10', '12'],
      ['ก.พ.', '8', '9']
    ]
  },
  'line',
  'รายเดือน'
)
assert.equal(multi.chart.datasets.length, 2)
assert.deepEqual(multi.chart.datasets[1], { label: 'หญิง', data: [12, 9] })

// วงกลมใช้ค่าชุดเดียว คอลัมน์ที่เกินมาต้องถูกตัดทิ้ง ไม่ใช่วาดซ้อน
assert.equal(toChart(multi_input(), 'pie', 'x').chart.datasets.length, 1)
function multi_input() {
  return { columns: ['เดือน', 'ชาย', 'หญิง'], rows: [['ม.ค.', '10', '12']] }
}

// ชิ้นเกิน 8 ในวงกลมต้องยุบเป็น "อื่นๆ" ไม่ใช่วนสีซ้ำ และยอดรวมต้องไม่หาย
const many = toChart(
  {
    columns: ['แผนก', 'จำนวน'],
    rows: Array.from({ length: 12 }, (_, i) => [`แผนก${i}`, String(12 - i)])
  },
  'pie',
  'ตามแผนก'
)
assert.equal(many.chart.labels.length, 8)
assert.match(many.chart.labels.at(-1), /^อื่นๆ/)
assert.equal(
  many.chart.datasets[0].data.reduce((a, b) => a + b, 0),
  78,
  'ยอดรวมหลังยุบต้องเท่าเดิม (12+11+...+1)'
)

// ค่าว่าง/ไม่ใช่ตัวเลขในบางแถวยังวาดได้ (เว้นจุดนั้นไป)
assert.deepEqual(
  toChart(
    {
      columns: ['เดือน', 'จำนวน'],
      rows: [
        ['ม.ค.', '5'],
        ['ก.พ.', null]
      ]
    },
    'bar',
    'x'
  ).chart.datasets[0].data,
  [5, null]
)

// รูปทรงที่วาดไม่ได้ ต้องคืน error ที่บอกวิธีแก้ ไม่ใช่กราฟเปล่า
assert.match(toChart({ columns: ['hn'], rows: [['1']] }, 'bar', 'x').error, /2 คอลัมน์/)
assert.match(toChart({ columns: ['a', 'b'], rows: [] }, 'bar', 'x').error, /ไม่ได้ข้อมูล/)
assert.match(
  toChart({ columns: ['เดือน', 'ชื่อ'], rows: [['ม.ค.', 'สมชาย']] }, 'bar', 'x').error,
  /ไม่ใช่ตัวเลข/
)
assert.match(
  toChart(
    { columns: ['a', 'b'], rows: Array.from({ length: 60 }, (_, i) => [String(i), '1']) },
    'bar',
    'x'
  ).error,
  /เกิน 50/
)
assert.match(toChart({ columns: ['a', 'b'], rows: [['x', '1']] }, 'bubble', 'x').error, /type ต้อง/)

// radar วาดได้ แต่แกนเยอะเกินอ่านไม่ออก ต้องกันไว้
const radar = toChart(
  {
    columns: ['ด้าน', 'ปีนี้', 'ปีที่แล้ว'],
    rows: [
      ['ความดัน', '80', '70'],
      ['เบาหวาน', '60', '65'],
      ['ไขมัน', '45', '40']
    ]
  },
  'radar',
  'คัดกรองรายด้าน'
)
assert.equal(radar.chart.datasets.length, 2)
assert.equal(radar.chart.labels.length, 3)
assert.match(
  toChart(
    { columns: ['a', 'b'], rows: Array.from({ length: 13 }, (_, i) => [String(i), '1']) },
    'radar',
    'x'
  ).error,
  /ไม่เกิน 12 แกน/
)

// ปิรามิดประชากร: ฝั่งซ้าย (ชาย) ต้องเป็นค่าติดลบ ฝั่งขวาคงเดิม และต้องมี 3 คอลัมน์พอดี
const pyr = toChart(
  {
    columns: ['กลุ่มอายุ', 'ชาย', 'หญิง'],
    rows: [
      ['0-4', '120', '110'],
      ['5-9', '130', '125']
    ]
  },
  'pyramid',
  'ปิรามิดประชากร'
)
assert.deepEqual(pyr.chart.datasets[0], { label: 'ชาย', data: [-120, -130] })
assert.deepEqual(pyr.chart.datasets[1], { label: 'หญิง', data: [110, 125] })
assert.match(
  toChart({ columns: ['กลุ่มอายุ', 'ชาย'], rows: [['0-4', '1']] }, 'pyramid', 'x').error,
  /3 คอลัมน์พอดี/
)

console.log('chart ok')
