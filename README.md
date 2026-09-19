# iPlkTest

แอปเดสก์ท็อปสำหรับคุยกับ AI agent ที่เขียนและรัน SQL บนฐานข้อมูล **HOSxP** ให้ได้เลย
ถามเป็นภาษาไทย → agent หาตารางเอง เขียน SQL เอง รันจริง แล้วสรุปผลกลับมาเป็นตาราง

Electron + React + Vite (electron-vite) · เรียกโมเดลผ่าน LiteLLM proxy (OpenAI-compatible) ไม่ต่อผู้ให้บริการตรง

## ทำอะไรได้

- ถามเป็นภาษาไทย agent ค้นหาตารางที่เกี่ยวข้องเอง (`SHOW TABLES` / `information_schema`) ไม่เดาชื่อ
- รัน SQL จริงบน MySQL/MariaDB **อ่านอย่างเดียว** เขียนได้เฉพาะตารางชั่วคราวชื่อขึ้นต้น `tmp_`
- ต่อ connection ค้างไว้ → ใช้ `CREATE TEMPORARY TABLE` ซอย query หนักเป็นหลายขั้นข้าม call ได้
- หลาย query ในรอบเดียวรันขนานผ่าน pool
- export ผลเป็นไฟล์ Excel (.xlsx) ลง Downloads แล้วกดเปิดจากในแอปได้
- เรียก REST API ภายนอกได้ทุก host
- วาดกราฟในหน้าแชทด้วย Chart.js (แท่ง/เส้น/วงกลม/โดนัท/เรดาร์/ปิรามิดประชากร)
- คำสั่งเสี่ยง (`SELECT *` ทั้งตารางไม่มี `LIMIT`) หยุดถามผู้ใช้ก่อนรัน
- ตอบแบบ stream, กดหยุดกลางคันได้แล้วสั่ง "ทำต่อ"
- ประวัติการสนทนาเก็บใน PGlite (Postgres ฝังในแอป) ที่ `userData/pgdata`

## ติดตั้ง

```bash
npm install
cp .env.example .env    # แล้วใส่ค่าให้ครบ
npm run dev
```

`.env` (ทุกค่าอยู่ฝั่ง main process โมเดลไม่เห็นรหัสผ่าน):

| ตัวแปร                                                          | ใช้ทำอะไร                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `LLM_BASE_URL`                                        | base url ของ LiteLLM proxy เช่น `http://localhost:4000/v1`                                      |
| `LLM_API_KEY`                                         | virtual key ของ proxy (ขึ้นต้น `sk-`) ขอจากผู้ดูแลระบบ                                          |
| `LLM_MODELS`                                          | ชื่อโมเดลที่ key นี้เรียกได้ คั่นด้วย `,` ตัวแรกเป็นค่าเริ่มต้น                                  |
| `DB_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | ฐานข้อมูล HOSxP                                                                                 |
| `API_TOKEN`                                           | token ที่แอปแนบให้ตอนเรียก API (ถ้ามี)                                                          |
| `OPENROUTER_API_KEY`                                  | คีย์ OpenRouter ให้ Jev คัดแหล่งที่ไม่น่าเชื่อถือออกจากผลค้นเว็บ (ไม่ใส่ = ไม่คัด)              |

> `.env` ถูกอ่านตอนเปิดแอป (ไม่ได้ฝังลงบันเดิลตอน build) แก้ค่าแล้วเปิดแอปใหม่พอ ไม่ต้อง build ใหม่
> ตอนแพ็กเป็นแอปแล้วให้วางไฟล์ `.env` ไว้ข้าง `.exe`

## คำสั่ง

```bash
npm run dev        # เปิดแอปโหมดพัฒนา
npm test           # เช็ค db / sql / parse / history / excel / api
npm run build      # build
npm run build:win  # ทำตัวติดตั้ง Windows
```

## โครงสร้าง

```
src/main/
  index.js        เปลือกแอป: หน้าต่าง + ipc
  agent.mjs       คุยกับโมเดล + tool loop + stream
  history.mjs     ประกอบบทสนทนาเก่ากลับเป็น tool_calls ก่อนส่งเข้าโมเดล
  prompt.md       instruction ของ agent (แก้ไฟล์นี้ไฟล์เดียว)
  db.mjs          เก็บบทสนทนา (PGlite)
  tools/
    sql.mjs       รัน SQL + กันคำสั่งเขียนข้อมูล
    excel.mjs     export .xlsx
    api.mjs       เรียก REST API
    web.mjs       ค้นหาความรู้จากอินเทอร์เน็ต + อ่านหน้าเว็บ (Jev คัดแหล่งที่ไม่เป็นทางการทิ้ง)
src/renderer/     หน้าจอแชท (React)
```

เพิ่ม tool ใหม่: สร้างไฟล์ใน `src/main/tools/` ให้ export ก้อน `{ name, description, parameters, run }`
แล้วต่อชื่อในรายการ `TOOL_LIST` ที่ `agent.mjs`

## ข้อควรระวัง

agent รัน SQL ได้เองโดยไม่ต้องกดยืนยัน มีแค่ตัวกรองด้วย regex กันคำสั่งเขียนข้อมูล
ของจริงควรต่อด้วย DB user ที่มีสิทธิ์ `SELECT` + `CREATE TEMPORARY TABLES` เท่านั้น
