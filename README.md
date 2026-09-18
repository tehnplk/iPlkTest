# iPlkTest

แอปเดสก์ท็อปสำหรับคุยกับ AI agent ที่เขียนและรัน SQL บนฐานข้อมูล **HOSxP** ให้ได้เลย
ถามเป็นภาษาไทย → agent หาตารางเอง เขียน SQL เอง รันจริง แล้วสรุปผลกลับมาเป็นตาราง

Electron + React + Vite (electron-vite) · โมเดลผ่าน OpenRouter

## ทำอะไรได้

- ถามเป็นภาษาไทย agent ค้นหาตารางที่เกี่ยวข้องเอง (`SHOW TABLES` / `information_schema`) ไม่เดาชื่อ
- รัน SQL จริงบน MySQL/MariaDB **อ่านอย่างเดียว** เขียนได้เฉพาะตารางชั่วคราวชื่อขึ้นต้น `tmp_`
- ต่อ connection ค้างไว้ → ใช้ `CREATE TEMPORARY TABLE` ซอย query หนักเป็นหลายขั้นข้าม call ได้
- หลาย query ในรอบเดียวรันขนานผ่าน pool
- export ผลเป็นไฟล์ Excel (.xlsx) ลง Downloads แล้วกดเปิดจากในแอปได้
- เรียก REST API ภายนอกได้ เฉพาะ host ที่อนุญาตไว้
- ตอบแบบ stream, กดหยุดกลางคันได้แล้วสั่ง "ทำต่อ"
- ประวัติการสนทนาเก็บใน PGlite (Postgres ฝังในแอป) ที่ `userData/pgdata`

## ติดตั้ง

```bash
npm install
cp .env.example .env    # แล้วใส่ค่าให้ครบ
npm run dev
```

`.env` (ทุกค่าอยู่ฝั่ง main process โมเดลไม่เห็นรหัสผ่าน):

| ตัวแปร                                                          | ใช้ทำอะไร                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `MAIN_VITE_OPENROUTER_API_KEY`                                  | คีย์ OpenRouter                                                                         |
| `MAIN_VITE_DB_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | ฐานข้อมูล HOSxP                                                                         |
| `MAIN_VITE_API_ALLOW`                                           | host ที่ยอมให้ tool `rest_api` เรียก เช่น `api.moph.go.th,*.go.th` (ว่าง = ห้ามทั้งหมด) |
| `MAIN_VITE_API_TOKEN`                                           | token ที่แอปแนบให้ตอนเรียก API (ถ้ามี)                                                  |

> ค่าใน `.env` ถูก inline เข้า bundle ตอน build — อย่าแจกไฟล์ที่ build พร้อมคีย์

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
    api.mjs       เรียก REST API ตาม allowlist
src/renderer/     หน้าจอแชท (React)
```

เพิ่ม tool ใหม่: สร้างไฟล์ใน `src/main/tools/` ให้ export ก้อน `{ name, description, parameters, run }`
แล้วต่อชื่อในรายการ `TOOL_LIST` ที่ `agent.mjs`

## ข้อควรระวัง

agent รัน SQL ได้เองโดยไม่ต้องกดยืนยัน มีแค่ตัวกรองด้วย regex กันคำสั่งเขียนข้อมูล
ของจริงควรต่อด้วย DB user ที่มีสิทธิ์ `SELECT` + `CREATE TEMPORARY TABLES` เท่านั้น
