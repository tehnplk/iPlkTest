import { askJev } from './jev.mjs'

// คีย์ระบุตัวคนที่ยอมให้ agent ดึงออกมาได้ อันไหนโผล่ในผลลัพธ์ก็เติมชื่อตามอันนั้น
const KEYS = ['hos_guid', 'person_id']
export const PERSON_COLUMNS = ['cid', 'hn', 'pname', 'fname', 'lname']
const key = (value) =>
  value === null || value === undefined ? '' : String(value).trim().toLowerCase()

// ชื่อคอลัมน์อย่างเดียวบอกไม่ได้ว่าคีย์นั้นคือคน — vn_stat.hos_guid เป็น guid ของวิสิต
// (30,961 ค่า จากผู้ป่วย 6,615 คน join กับ patient.hos_guid ได้ 0 แถว) icd101 ก็มี hos_guid
// ให้ jev อ่าน SQL กับชื่อคอลัมน์ผลลัพธ์แล้วตัดสินว่าจะเติมจากทะเบียนไหน หรือไม่เติมเลย
// วัดจริง 6/6: patient 1.00/0.76, person 1.00, vn_stat→none 0.80, icd101→none 0.93, สรุปรวม→none 1.00
export async function chooseHook(sql, columns, signal, ask = askJev) {
  const answers = await ask(
    { sql: String(sql ?? '').replace(/\s+/g, ' '), result_columns: columns.join(', ') },
    {
      hook: {
        type: 'choice',
        instructions:
          'Each result row identifies which kind of record? Choose what the key column in result_columns refers to',
        criteria: {
          patient:
            'A row of the hospital patient registry — the key column is patient.hos_guid, one value per patient',
          person:
            'A row of the population registry — the key column is person.person_id, one value per resident',
          none: 'Neither — the rows are aggregates, reference data, or the key column is a guid of a visit or of a row in some other table rather than of a person'
        }
      }
    },
    signal
  )
  // jev ฟันธงมาในฟิลด์ choice เอง ไม่ต้องหา argmax จาก probabilities
  const pick = answers?.hook?.choice
  if (!pick) return undefined // jev ตัดสินไม่ได้ ให้ผู้เรียกถอยไปดูชื่อคอลัมน์แทน
  return pick === 'patient' ? 'hos_guid' : pick === 'person' ? 'person_id' : null
}

// เติม cid, hn, ชื่อ-สกุล ต่อท้ายตาราง {columns, rows} — คืนตัวเดิมถ้าไม่มีคีย์ระบุคน
// ใช้ทั้งกับตารางบนจอและกับไฟล์ Excel ไม่งั้นสองอย่างไม่ตรงกัน
export async function enrichResult(result, sql, lookup, signal, decide = chooseHook) {
  if (result?.error || !Array.isArray(result?.columns) || !Array.isArray(result?.rows))
    return result
  const index = result.columns.findIndex((column) => KEYS.includes(column.toLowerCase()))
  if (index < 0) return result
  signal?.throwIfAborted()

  const named = result.columns[index].toLowerCase()
  const by = await decide(sql, result.columns, signal)
  if (by === null) return result // jev บอกว่าคีย์นี้ไม่ใช่คน เติมไปก็ได้ค่าว่างเปล่า
  signal?.throwIfAborted()

  const ids = [...new Set(result.rows.map((row) => row[index]).filter((id) => key(id)))]
  // jev ล่ม (undefined) ถอยไปเชื่อชื่อคอลัมน์เหมือนเดิม ดีกว่าไม่เติมอะไรเลย
  const people = ids.length ? await lookup(by ?? named, ids, signal) : []
  signal?.throwIfAborted()
  const byId = new Map(people.map((person) => [key(person.id), person]))
  return {
    ...result,
    columns: [...result.columns, ...PERSON_COLUMNS],
    rows: result.rows.map((row) => {
      const person = byId.get(key(row[index]))
      return [...row, ...PERSON_COLUMNS.map((column) => person?.[column] ?? null)]
    })
  }
}

// Only replace the display result. modelMessages remains the original agent history.
export async function appendPersonDetails(answer, lookup, signal, decide = chooseHook) {
  const result = answer?.step?.result
  const enriched = await enrichResult(
    result,
    answer?.step?.querySql ?? answer?.step?.sql,
    lookup,
    signal,
    decide
  )
  return enriched === result ? answer : { ...answer, step: { ...answer.step, result: enriched } }
}
