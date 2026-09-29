import { Sandbox } from '@vercel/sandbox'

// ข้อมูลที่ส่งขึ้น Vercel ได้มากสุด — เกินนี้ให้กรอง/สุ่มใน SQL มาเอง
export const MAX_STATS_ROWS = 50000
const RUN_MS = 120_000
const MAX_OUT = 20000
const LIBS = ['pandas', 'numpy', 'scipy', 'statsmodels', 'scikit-learn']

// ค่ามาจาก .env — ใช้ access token เพราะ OIDC token ของเครื่อง dev หมดอายุทุก 12 ชม.
const env = (key) => process.env[key] ?? ''
const auth = () => ({
  teamId: env('VERCEL_TEAM_ID'),
  projectId: env('VERCEL_PROJECT_ID'),
  token: env('VERCEL_TOKEN')
})

// รับ job.json {columns, rows, code} → df แล้วรันโค้ดของโมเดล ผลคือสิ่งที่ print ออกมา
const RUNNER = `import json, warnings
import numpy as np, pandas as pd
import scipy.stats as stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
warnings.filterwarnings("ignore")
job = json.load(open("job.json"))
df = pd.DataFrame(job["rows"], columns=job["columns"])
# MySQL ส่งมาเป็น string ทั้งหมด คอลัมน์ไหนเป็นเลขได้ทั้งคอลัมน์ก็แปลง ที่เหลือคงเป็นตัวแปรกลุ่ม
for c in df.columns:
    num = pd.to_numeric(df[c], errors="coerce")
    if num.notna().sum() == df[c].notna().sum():
        df[c] = num
exec(job["code"], {"df": df, "pd": pd, "np": np, "stats": stats, "sm": sm, "smf": smf})
`

// ติดตั้งไลบรารีครั้งเดียวแล้วเก็บเป็น snapshot — ตอนใช้จริงเปิดจาก snapshot แบบปิดเน็ต ไม่ต้อง pip ทุกครั้ง
export async function buildSnapshot() {
  const box = await Sandbox.create({ ...auth(), runtime: 'python3.13', timeout: 10 * 60_000 })
  try {
    const pip = await box.runCommand('python3', ['-m', 'pip', 'install', ...LIBS])
    if (pip.exitCode) throw new Error(await pip.stderr())
    await box.writeFiles([{ path: 'runner.py', content: Buffer.from(RUNNER) }])
    return (await box.snapshot({ expiration: 0 })).snapshotId
  } finally {
    await box.stop().catch(() => {})
  }
}

// sandbox ได้แค่ตัวแปร — คีย์ระบุตัวคนไม่มีประโยชน์ทางสถิติ และไม่ควรออกนอก รพ.
export function variablesOnly(res) {
  if (res.error) return res
  if (res.personKey)
    return {
      error:
        'ห้ามส่ง patient.hos_guid / person.person_id เข้า sandbox — SELECT เฉพาะตัวแปรที่จะวิเคราะห์ (อายุ เพศ ค่าแล็บ รหัสโรค สิทธิ ฯลฯ)'
    }
  if (res.truncated)
    return {
      error: `ได้ ${res.rowCount.toLocaleString()} แถว เกิน ${MAX_STATS_ROWS.toLocaleString()} ให้กรองให้แคบลง หรือสุ่มด้วย ORDER BY RAND() LIMIT`
    }
  if (!res.rows.length) return { error: 'query ไม่ได้ข้อมูลกลับมา ไม่มีอะไรให้วิเคราะห์' }
  return { columns: res.columns, rows: res.rows }
}

export async function runInSandbox(job, signal) {
  const snapshotId = env('VERCEL_SNAPSHOT_ID')
  if (!env('VERCEL_TOKEN') || !snapshotId)
    return {
      error:
        'ยังไม่ได้ตั้ง Vercel Sandbox — ใส่ VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN ใน .env แล้วรัน npm run sandbox:snapshot เอา VERCEL_SNAPSHOT_ID มาใส่'
    }
  const box = await Sandbox.create({
    ...auth(),
    source: { type: 'snapshot', snapshotId },
    networkPolicy: 'deny-all',
    persistent: false,
    timeout: RUN_MS + 60_000,
    signal
  })
  try {
    await box.writeFiles([{ path: 'job.json', content: Buffer.from(JSON.stringify(job)) }], {
      signal
    })
    const done = await box.runCommand('python3', ['runner.py'], { signal, timeoutMs: RUN_MS })
    const [stdout, stderr] = await Promise.all([done.stdout(), done.stderr()])
    return {
      exitCode: done.exitCode,
      stdout: stdout.slice(0, MAX_OUT),
      ...(done.exitCode ? { stderr: stderr.slice(-4000) } : {})
    }
  } finally {
    // ปิดทิ้งทุกกรณี ข้อมูลไม่ค้างบน Vercel
    await box.stop().catch(() => {})
  }
}

export const statsTool = {
  name: 'tool_stat_analysis',
  description: `วิเคราะห์สถิติชั้นสูงด้วย Python ใน Vercel Sandbox (VM แยก ปิดอินเทอร์เน็ต ทิ้งทันทีหลังรัน)
ใช้เมื่อผู้ใช้ขอสิ่งที่ SQL ทำไม่ได้: regression (linear/logistic), t-test, chi-square, ANOVA, correlation, ช่วงความเชื่อมั่น, การกระจาย ฯลฯ
ขั้นตอน: sql ดึงเฉพาะตัวแปรที่ใช้วิเคราะห์ (ห้ามมีคีย์ระบุตัวคนหรือข้อมูลส่วนบุคคล — ระบบตรวจก่อนส่ง) → ข้อมูลเข้า sandbox เป็น df
code คือ Python ที่มีให้ใช้แล้ว: df (pandas DataFrame คอลัมน์ตาม alias ของ sql, คอลัมน์ตัวเลขแปลงให้แล้ว), pd, np, stats (scipy.stats), sm (statsmodels.api), smf (statsmodels.formula.api) และ import sklearn ได้
ก่อนสร้างโมเดลทุกครั้ง:
  1. หน่วยวิเคราะห์ต้องเป็นคน ไม่ใช่วิสิต — ตารางรายครั้ง (opdscreen, ovst, lab) คนเดียวมีหลายแถว ทำให้ p-value เล็กเกินจริง
     ให้ยุบเป็นหนึ่งแถวต่อคนใน SQL ด้วย GROUP BY hn (hn ใช้ใน GROUP BY ได้ แค่ห้าม SELECT ออกมา) เช่น AVG(bmi), MAX(bps >= 140)
     ส่งคีย์คนเข้า sandbox ไม่ได้ จึงใช้ GEE/mixed model แบบจับกลุ่มตามคนไม่ได้
  2. print(df.describe()) ดูการกระจาย แล้วตัดค่าที่เป็นไปไม่ได้ออกก่อน (เช่น BMI นอก 10–70, bps นอก 60–260, ค่า 0 ที่แปลว่าไม่ได้วัด) และ print ว่าตัดไปกี่แถว
ต้อง print() ผลที่ต้องการเท่านั้น (เช่น print(smf.logit("dm ~ age + C(sex)", df).fit(disp=0).summary())) ไม่มีเน็ต เขียนไฟล์ไม่ได้ ไม่เกิน ${MAX_STATS_ROWS.toLocaleString()} แถว
คืน {rowCount, variables, exitCode, stdout, stderr} — จอแสดง stdout ให้ผู้ใช้แล้ว ตอบสรุปความหมาย (ค่าสำคัญ, p-value, CI) สั้นๆ ถ้า exitCode ไม่เป็น 0 ให้แก้ code แล้วรันใหม่`,
  parameters: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description:
          'SELECT ตัวแปรระดับแถว ตั้ง alias อังกฤษสั้นๆ ใช้ในสูตรได้ เช่น SELECT TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age, p.sex, s.bps FROM ...'
      },
      code: { type: 'string', description: 'Python ที่ใช้ df แล้ว print ผล' }
    },
    required: ['sql', 'code']
  },
  run: async (args, signal, { db }) => {
    const res = await db.query(args.sql ?? '', signal, MAX_STATS_ROWS)
    const data = variablesOnly(res)
    if (data.error) return data
    const out = await runInSandbox({ ...data, code: args.code ?? '' }, signal)
    return { rowCount: res.rowCount, variables: data.columns, ...out }
  }
}
