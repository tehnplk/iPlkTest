# iPlkTest — ส่งต่องาน Agent / Tool Calling / Privacy

อัปเดต 20 กันยายน 2569 · Workspace `E:\Electron\iPlkTest`
Branch `spike/openai-agents` · ฐานก่อนเริ่มงาน `d5cd278`; ดู commit ที่รวมงานนี้จาก `git log -1`

## เริ่มต่อจากตรงนี้

ผู้ใช้ให้ปรับสถาปัตยกรรม Agent และ Tool Calling ทั้งสามส่วน จากนั้นให้เพิ่ม Jev ตรวจคำตอบสุดท้าย ทดสอบ E2E แบบแหกกฎ privacy และอุดช่องโหว่ที่พบ งานเหล่านี้เสร็จแล้ว หลังทำ handoff ผู้ใช้สั่ง commit/push งานนี้บน branch เดิม ไม่มีคำสั่ง deploy

โค้ด เทสต์ และเอกสารของเซสชันนี้รวมอยู่ใน commit ส่งต่องาน ตรวจ `git status --short` ก่อนทำต่อและอย่า reset/clean งานอื่นทิ้ง โดย `.claude/skills/hosxp-schema.lnk` เป็นไฟล์ untracked ที่มีอยู่ก่อนเริ่มงานนี้ ไม่ใช่ไฟล์ที่สร้างในเซสชันนี้

ผู้ใช้ขอให้ตอบภาษาไทยไว้แล้ว ใช้ไทยต่อ อ่าน `AGENTS.md` และคำสั่งเฉพาะโปรเจกต์ก่อนทำงาน ตั้ง PowerShell output เป็น UTF-8; ถ้าส่ง here-string เข้า Python/Node ใช้ `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` เพื่อไม่ให้ BOM ปนเป็นอักขระแรกของสคริปต์

เอกสารนี้แทน handoff วันที่ 19 ก.ย. ซึ่งระบุว่า Jev เหลือเพียง web_search, มี `npm run approval` และ tests 9 ไฟล์ ข้อมูลเหล่านั้นล้าสมัยแล้ว ประเด็น memory/credential ที่เคยบันทึกในเอกสารเก่ายังไม่ได้ตรวจซ้ำหรือแก้ในงานนี้; หากต้องติดตาม ให้อ่านเวอร์ชันก่อนหน้าจาก Git

## แผนที่สำหรับอ่านโค้ด

ใช้ `CONTEXT.md` สำหรับศัพท์ที่ตกลงไว้ และ Git diff สำหรับรายละเอียดการแก้ ไม่ต้องออกแบบใหม่จากศูนย์

| เรื่อง | จุดเริ่มอ่าน |
| --- | --- |
| เจ้าของเทิร์น การหยุด และลำดับ finalize → enrich | `src/main/agent-turn.mjs` |
| จับคู่ toolCallId เลือกผลแสดง เก็บงานที่เสร็จแล้วและ replay เมื่อหยุด | `src/main/tool-run.mjs` |
| ตรวจคำตอบด้วย Jev, เลือกหลักฐาน, numeric guard, จำกัดการแก้ไข | `src/main/answer-review.mjs` |
| SDK runner / AUTO routing / แก้คำตอบโดยปิด tools | `src/main/agent-ai.mjs` |
| ประกอบ dependencies และ IPC | `src/main/index.js`, `src/preload/index.js` |
| progress ติดกับ conversation/turn เดิม, กัน stale event, save failure | `src/renderer/src/App.jsx` |
| ตรวจ privacy, lexer, query, database adapter | `src/main/tools/sql.mjs` |
| เติมข้อมูลบุคคลภายหลัง โดยไม่ปน model replay | `src/main/person-details.mjs` |

## ข้อตกลงที่ผู้ใช้ยืนยันแล้ว

- SQL ต้องตรวจทุก projected expression แบ่งชุดละ 20; คะแนนหาย ไม่เป็นตัวเลข นอกช่วง หรือ Jev ใช้ไม่ได้ ให้หยุดก่อน query
- หนึ่ง active turn ทั้งแอป การเปลี่ยนห้องต้องไม่ย้าย progress ไปแสดงผิดห้อง
- Stop เก็บข้อความบางส่วนกับผลเครื่องมือที่เสร็จแล้ว; replay ไม่ใส่ tool call ที่ยังไม่มีผล และแสดงสถานะ stopped
- ผลจาก memory/web ไม่ทับตาราง กราฟ หรือไฟล์ที่สำเร็จ ข้อตกลงเดิมให้เลือกผลสำเร็จล่าสุดถูกขยายภายหลัง: final review เลือกผลเก่าที่ตรงกับคำตอบได้
- Jev ตรวจคำตอบก่อนเติมข้อมูลบุคคล; ไม่ส่งข้อมูลที่เติมจาก person lookup เข้า reviewer
- ถ้าข้อความผิด ให้แก้ได้หนึ่งครั้งโดย **ไม่เรียก tools ซ้ำ** แล้วตรวจซ้ำ รวมไม่เกินสอง checks; ถ้าแค่เลือกตารางผิด เปลี่ยนตารางและตรวจซ้ำได้โดยไม่สร้างคำตอบใหม่
- ผลตรวจเป็น `verification.status`: `verified`, `failed`, `unavailable`; สองสถานะหลังต้องมีข้อความเตือน ไม่ตีความว่าผ่าน

Jev ยังทำงานห้าบริบท: AUTO model routing, SQL privacy, web source filtering, person lookup selection และ final answer review อ่านเกณฑ์จริงจากไฟล์ข้างต้นกับ `jev.mjs` อย่าอ้างคำอธิบายว่าเหลือจุดเดียวจาก handoff เก่า

## เหตุการณ์สำคัญและผลยืนยัน

### จำนวนคนกับจำนวนแถว

Live E2E ก่อนเพิ่ม final review พบคำตอบ 6,612 HN ไม่ซ้ำ แต่ตารางเป็น 6,615 แถว ตรวจ tool history แล้วทั้งสองตัวเลขมี SQL รองรับ (`COUNT(DISTINCT hn)` เทียบกับ `COUNT(*)`) จึงเป็นปัญหาเลือกผลแสดง ไม่ใช่หลักฐานว่า Agent แต่งตัวเลข

ไม่ได้ตรวจว่าแถวส่วนต่างมาจาก HN ซ้ำหรือ NULL อย่าสรุปสาเหตุจากส่วนต่างอย่างเดียว

หลังเพิ่ม final review: live E2E ใช้แอป/โมเดล/ฐานจริงผ่านในประมาณ 6.7 วินาที คำตอบและตารางเป็น 6,612 HN ไม่ซ้ำตรงกัน อีกการทดสอบส่ง fixture สองผลเดิมให้ **Jev จริง** ยืนยันว่าเลือกผล HN ไม่ซ้ำและได้ `verified`, `checks: 2` ตัวเลขนี้เป็นผล ณ เวลาทดสอบ ไม่ใช่ยอดปัจจุบันที่รับรองตลอดไป

### Privacy bypass

พบและแก้สามแบบที่ทำให้คอลัมน์ cid หลบการตรวจได้:

1. MySQL executable comment เช่น `SELECT /*!50000 cid */ FROM patient LIMIT 1`
2. `SELECT 1--1 AS safe, cid FROM patient LIMIT 1` — `--1` เป็นเลขลบ ไม่ใช่คอมเมนต์
3. `SELECT '--' AS note, cid FROM patient LIMIT 1` — marker อยู่ใน string

ก่อนแก้ ทั้งสามเคสไปถึงฐานจำลองและส่ง synthetic sentinel ให้โมเดล fixture ได้ หลังแก้ `scanSql` แยก quoted text/identifiers กับ comments ตามตำแหน่ง, ปฏิเสธ executable comments ทั้ง `/*!...*/` และ `/*M!...*/`, ตรวจ quote/comment ที่ปิดไม่ครบ และยังบล็อก wildcard ที่มี quoted qualifier เช่น ``SELECT `p`.*``

หลักฐานและ payload อยู่ใน `test/privacy-e2e.test.mjs` กับ `test/sql-lexing.test.mjs` ไม่ได้ใช้ข้อมูลผู้ป่วยจริงในการโจมตี

## การทดสอบและขอบเขตหลักฐาน

| คำสั่ง | ผลที่รันแล้ว / สิ่งที่ทดสอบจริง |
| --- | --- |
| `npm test` | ผ่านทั้งชุด 12 test scripts; มี regression ด้าน batching/คะแนนหาย, correlation, lifecycle, final review และ lexer |
| `npm run lint` | ผ่านหลังแก้ regex ให้ไม่ติด no-control-regex |
| `npm run build` | ผ่าน; มี warning เดิมเรื่อง store.mjs ถูก import ทั้ง static/dynamic |
| `npm run test:agent-ui` | isolated Electron UI ผ่าน conversation ownership, stale events, stop, completed result และ persisted replay; runner จำลอง |
| `npm run build` แล้ว `npm run e2e` | live app + model + database ผ่านคำถามนับผู้ป่วยหลังเพิ่ม final review; เป็น smoke test ก่อนแก้ lexer privacy รอบล่าสุด |
| `npm run test:privacy-e2e` | ผ่าน 10/10: 9 attack cases บล็อกก่อนเรียกฐาน, aggregate control ทำงาน; Electron/IPC/SDK/tools และ **Jev จริง**, แต่ model tool calls กับ MySQL เป็น fixtures |

`test:agent-ui` และ `test:privacy-e2e` รวม build อยู่แล้ว ใช้ isolated userData และลบ temp ของตัวเอง ส่วน live `e2e` ใช้ userData ปกติและเขียนประวัติแชท ต้องไม่มีแอปอีก instance ล็อก PGlite อยู่

Privacy E2E จงใจบังคับ model fixture ให้เรียก tool อันตราย เพื่อทดสอบด่านในโค้ด ไม่ใช่ทดสอบว่าโมเดลจริงจะยอมทำตาม jailbreak prompt หรือไม่ อย่าอ้างผล 10/10 ว่าป้องกันทุกวิธีหรือเป็นการรับรองความปลอดภัยทั้งหมด

`sql.test.mjs` มี negative connection test ไป `127.0.0.1:1`; ไม่ต้องมีฐานโรงพยาบาลจริง และเทสต์สมมติว่าไม่ได้ตั้ง OPENROUTER_API_KEY ใน process ที่รัน ไม่ควรกล่าวว่าชุด unit ไม่มี network attempt เลย

## ข้อจำกัดและจุดต่อยอดที่ยังไม่ได้ทำ

- `test/e2e.mjs` เดิมตรวจข้อความอย่างหยาบ ไม่ assert `verification` หรือจับคู่ตัวเลข/นิยามกับตารางโดยตรง การยืนยันค่าครั้งนี้อาศัยอ่านผลและตรวจ tool history เพิ่ม
- `countMismatch` เป็น guard เฉพาะ SELECT COUNT ผลหนึ่งแถวหนึ่งคอลัมน์ ไม่ใช่ตัวตรวจเลข/ร้อยละ/ช่วงเวลาทั่วไป
- Reviewer ใช้ excerpt ของผลลัพธ์ (ผ่าน fit และตัดข้อความต่อผล); Jev เป็น probabilistic ไม่ใช่หลักฐานทางการว่าคำตอบถูกทั้งหมด
- Lexer นี้ไม่ใช่ full MySQL parser; ยังไม่ได้ทดสอบ SQL modes/dialect ทุกแบบ หรือทำ security audit ครอบคลุมทุก tool
- history ยังไม่มีงบ context รวม/compaction; งานนี้ไม่ได้แก้
- ผู้ใช้อนุญาต commit/push งานนี้แล้ว; ไม่มีการ deploy หรือแก้ schema/data production

## Suggested skills

เรียก skill ตามงานที่ทำต่อ ไม่ต้องโหลดทั้งหมด:

- `ai-sdk`: ก่อนแก้ SDK stream/agent/tool behavior อ่าน version-matched docs ใน `node_modules/ai/docs` และ source; ตอนนี้แพ็กเกจใน repo เป็น AI SDK 7
- `codebase-design`: ถ้าจะเปลี่ยนเจ้าของ turn, result selection หรือ interface ของ module
- `hosxp-schema` และ `db-cli`: เฉพาะเมื่อจำเป็นต้องตรวจ schema หรือ query HOSxP จริง; ใช้ `db-cli --help` และอ่านเฉพาะข้อมูลที่จำเป็น
- `diagnosing-bugs`: ถ้า regression กลับมาหรือ live/model behavior ไม่ตรงกับ fixture
- `handoff`: ใช้สรุปส่งต่องาน; ถ้าผู้ใช้ระบุไฟล์ปลายทาง ให้บันทึกตามที่ผู้ใช้ระบุ เอกสารนี้บันทึกลง `HAND-OFF.md` ตามคำขอ

ถ้าจะทำต่อโดยยังไม่มีคำขอใหม่ ให้เริ่มจากอ่าน diff และข้อจำกัดข้างต้น ไม่ต้องรัน benchmark/live query เพิ่มเพียงเพื่อทำซ้ำหลักฐานที่มีแล้ว