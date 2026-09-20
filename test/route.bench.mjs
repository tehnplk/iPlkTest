// วัดว่า jev จับคู่คำถาม -> ระดับความยาก (glm/qwen/deepseek) ได้แม่นแค่ไหน — npm run bench:route
// ยิง jev จริง (ต้องมี OPENROUTER_API_KEY) เลยไม่อยู่ใน npm test
// แก้ LEVEL_CRITERIA หรือ HOSXP เมื่อไหร่ ให้รันอันนี้ก่อน commit
import fs from 'node:fs'
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] ??= m[2].trim()
}
const { askJev, HOSXP } = await import('../src/main/jev.mjs')

const CRITERIA = {
  hard: 'The answer needs at least one of: three or more tables joined; looking a code up in a registry table before it can be filtered on; finding people for whom a record is ABSENT (never vaccinated, never screened, did not return); or arithmetic on dates and ages such as an age window at a given date. Clinical indicators defined by a ministry or funder are hard',
  medium:
    'The answer needs one or two tables plus a WHERE and a GROUP BY, or a distinct count over a date range. It may take one lookup to confirm which table holds the data, but no registry decoding and no absence check',
  easy: 'The answer is a single count, sum or short listing straight out of one obvious table with at most a simple filter. Also easy: a greeting, chitchat, or a follow-up on the previous answer such as make it a chart, export to excel, show more rows, sort differently'
}

const CASES = [
  ['easy', 'มีผู้ป่วยทั้งหมดกี่คน'],
  ['easy', 'สวัสดีครับ'],
  ['easy', 'ขอรายชื่อผู้ป่วยหญิง 5 คน'],
  ['easy', 'ทำเป็นกราฟให้หน่อย'],
  ['easy', 'ขอเป็นไฟล์ excel'],
  ['medium', 'ปี 2567 มีผู้ป่วยนอกมารับบริการกี่คน นับแบบไม่ซ้ำคน'],
  // ของจริงคือ COUNT(*) FROM opd_allergy ตารางเดียว — ป้ายเดิมผมเขียนผิดเอง
  ['easy', 'มีคนไข้กี่คนที่แพ้ยา'],
  ['medium', 'ผู้ป่วยนอกเดือนนี้แยกตามสิทธิการรักษา'],
  // ต้องหารหัสคลินิกจากทะเบียน clinic ก่อน แล้ว join clinicmember + person + village = hard
  ['hard', 'คนไข้เบาหวานในคลินิกมีกี่คน แยกตามหมู่บ้าน'],
  ['hard', 'ดึงรายชื่อเด็ก 0-5 ปี ที่ยังไม่ได้รับวัคซีน MMR2'],
  ['hard', 'หญิง 29-60 ปี ที่ยังไม่ได้ตรวจ pap smear ในรอบ 2 ปี เป้าหมายปีงบ 2569'],
  ['hard', 'เคสที่ dx รหัสแผนไทย แต่ไม่ได้ยาแผนไทย'],
  ['hard', 'ผู้ป่วยเบาหวานที่ HbA1c เกิน 7 และไม่ได้มาตามนัดครั้งล่าสุด'],
  ['hard', 'อัตราการควบคุมความดันของผู้ป่วย HT ในเขตรับผิดชอบ ตามเกณฑ์ สปสช.']
]

let wrong = 0
for (const [want, prompt] of CASES) {
  const a = await askJev(
    { hosxp: HOSXP, user_request: prompt },
    {
      level: {
        type: 'choice',
        instructions:
          'How much SQL work does this request take on a hospital database? Judge the shape of the query needed, not how unfamiliar the wording sounds',
        criteria: CRITERIA
      }
    }
  )
  const probs = a?.level?.probabilities ?? {}
  const [pick, p] = Object.entries(probs).sort((x, y) => y[1] - x[1])[0] ?? []
  if (pick !== want) wrong++
  console.log(
    `${pick === want ? '  ' : '!!'} ควร ${want.padEnd(6)} ได้ ${String(pick).padEnd(6)} ${Number(p).toFixed(2)}  ${prompt.slice(0, 58)}`
  )
}
console.log(`\nผิด ${wrong}/${CASES.length}`)
