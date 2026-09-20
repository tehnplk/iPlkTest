---
name: hosxp-schema
description: 'HOSxP hospital database schema knowledge — table names, columns, and the hn/vn/an join model. Use when: (1) writing or reviewing SQL against a HOSxP/MySQL hospital database, (2) looking for which table holds patients, visits, admissions, lab, drugs, appointments, billing, or PCU/community data, (3) deciding how to join HOSxP tables, (4) debugging a query that returns 0 rows or the wrong table. Triggers on: "HOSxP", "hn vn an", "ovst", "ipt", "opdscreen", "opitemrece", "ovstdiag", "lab_head", "drugitems", "icd101", "ตาราง HOSxP", "ฐานข้อมูลโรงพยาบาล", "คลินิกโรคเรื้อรัง", "ผู้ป่วยนอก", "ผู้ป่วยใน".'
---

## กฎข้อเดียวที่สำคัญที่สุด

**เอกสารนี้เป็นสเปก ไม่ใช่ schema ของโรงพยาบาลที่คุณกำลังต่ออยู่**

ชื่อคอลัมน์ ชนิดข้อมูล และความยาว ต่างกันได้ตามเวอร์ชัน HOSxP และการติดตั้งของแต่ละโรงพยาบาล ฐานหนึ่งมีตารางระดับพันตาราง และหลายตารางในรายการนี้โรงพยาบาลนั้นอาจไม่ได้เปิดใช้เลย

ยืนยันก่อนเขียน query จริงเสมอ:

```sql
SHOW TABLES LIKE '%คำค้น%';        -- เร็วมาก เริ่มจากอันนี้
SHOW COLUMNS FROM ovst;            -- MySQL / MariaDB
DESCRIBE ovst;                     -- เหมือนกัน

-- PostgreSQL ไม่มี DESCRIBE
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'ovst' ORDER BY ordinal_position;
```

เจอตารางแล้วต้องเช็คด้วยว่ามีข้อมูลจริงไหม (`SELECT COUNT(*)`) และค่ารหัสหน้าตาเป็นยังไง (`SELECT ... LIMIT 3`) อย่าเดาว่า `sex` เป็น `'M'/'F'`

## โมเดลการเชื่อมตาราง: hn / vn / an

คีย์สามตัวนี้คือทั้งหมดที่ต้องรู้เพื่อเชื่อมตาราง HOSxP ส่วนใหญ่

| คีย์ | คือ | ระดับ |
| --- | --- | --- |
| `hn` | Hospital Number | ผู้ป่วยหนึ่งราย |
| `vn` | Visit Number | การมา OPD หนึ่งครั้ง |
| `an` | Admission Number | การนอน รพ. หนึ่งครั้ง |

```
patient.hn ──┬──> ovst.hn ──┬──> doctor.code            (ผ่าน ovst.doctor)
             │              └──> kskdepartment.depcode  (ผ่าน ovst.cur_dep)
             └──> ipt.hn

ovst.vn ──> lab_head.vn ──> lab_head.lab_order_number ──> lab_order.lab_order_number
```

**กับดักที่เจอบ่อย:** `lab_head` กับ `lab_order` เชื่อมกันด้วย `lab_order_number` **ไม่ใช่** `vn` — join ผิดคีย์แล้วได้ 0 แถวโดยไม่มี error  ถ้า join แล้วได้ 0 แถว ให้สงสัยคีย์ก่อนสงสัยข้อมูล

## ตารางหลักที่มีเอกสารระบุคอลัมน์

### patient — ทะเบียนผู้ป่วย (หนึ่งแถว = หนึ่งคน)

| คอลัมน์ | ชนิด | ความหมาย |
| --- | --- | --- |
| `hos_guid` | varchar(38) | PK รูปแบบ GUID |
| `hn` | varchar(9) | Hospital Number, unique |
| `pname` / `fname` / `lname` | varchar | คำนำหน้า / ชื่อ / นามสกุล |
| `sex` | char(1) | **1 = ชาย, 2 = หญิง** |
| `birthday` | date | วันเกิด (ค.ศ.) |
| `bloodgrp` | varchar(20) | หมู่เลือด |
| `pttype` | char(2) | รหัสสิทธิการรักษา |
| `nationality` / `religion` / `occupation` | char/varchar | สัญชาติ / ศาสนา / อาชีพ |
| `firstday` / `last_visit` | date | ลงทะเบียนครั้งแรก / มาครั้งล่าสุด |
| `last_update` | datetime | แก้ไขล่าสุด |

`patient.cid` (เลขบัตรประชาชน) เป็นฟิลด์อ่อนไหว — ระบบ API ของ BMS ห้ามเข้าถึงผ่าน REST และ mask ใน SQL เมื่อไม่มีสิทธิ์ ถ้าเขียนแอปเอง ให้ถือว่าฟิลด์นี้ต้องมีเหตุผลก่อนดึง

### ovst — การรับบริการผู้ป่วยนอก (หนึ่งแถว = หนึ่ง visit)

| คอลัมน์ | ความหมาย |
| --- | --- |
| `vn` | Visit Number, unique |
| `hn` | FK → `patient.hn` |
| `vstdate` / `vsttime` | วันที่ / เวลาที่มาตรวจ |
| `doctor` | FK → `doctor.code` |
| `cur_dep` | FK → `kskdepartment.depcode` (แผนกปัจจุบัน) |
| `main_dep` | รหัสแผนกหลัก |
| `spclty` | รหัสสาขาความเชี่ยวชาญ |
| `pttype` | สิทธิที่ใช้ใน visit นี้ (อาจต่างจาก `patient.pttype`) |
| `staff` | ผู้ลงทะเบียน |

### kskdepartment — แผนก

`depcode` (PK) · `department` (ชื่อแผนก) · `spclty` · `doctor_code` · `hospital_department_id` (รหัสอ้างอิงระดับกระทรวง)

### doctor — แพทย์

`code` (PK) · `name` · `shortname` · `licenseno` · `department` · `active` (`Y`/`N`)

## ตารางที่เอกสารระบุเฉพาะ join key

| ตาราง | คอลัมน์ที่ยืนยันได้ | หมายเหตุ |
| --- | --- | --- |
| `ipt` | `an` (unique), `hn` → patient, `regdate`, `dchdate` | **`dchdate IS NULL` = ยังนอนอยู่** |
| `lab_head` | `vn` → ovst, `lab_order_number` | คอลัมน์อื่นต้อง DESCRIBE เอง |
| `lab_order` | `lab_order_number` → lab_head | **ผลตรวจอยู่ในนี้ แต่ชื่อคอลัมน์ไม่มีในสเปก** |
| `icd101` | `code`, `code3`, `name` (อังกฤษ), `tname` (ไทย) | ทะเบียนรหัส ICD-10 |

## แผนที่ตารางตามโมดูล

ใช้หาว่า "เรื่องนี้น่าจะอยู่ตารางไหน" แล้วค่อย `SHOW TABLES LIKE` ยืนยัน

| โมดูล | ตาราง |
| --- | --- |
| ทะเบียนผู้ป่วย | `patient`, `pname` |
| OPD | `ovst`, `ovstdiag`, `opdscreen`, `opdscreen_cc_list`, `vn_stat`, `er_regist`, `ovst_vaccine`, `ovst_doctor_diag` |
| IPD | `ipt`, `iptdiag`, `an_stat`, `ipt_newborn`, `ipt_pttype` |
| คลอด | `ipt_labour`, `ipt_labour_infant`, `ipt_labour_complication` |
| แล็บ/รังสี | `lab_head`, `lab_order`, `lab_items`, `lab_items_group`, `lab_specimen_items`, `xray_head`, `xray_report` |
| ยา/เวชภัณฑ์ | `opitemrece`, `drugitems`, `s_drugitems`, `nondrugitems` |
| ผ่าตัด | `operation_list`, `operation_set` |
| ทันตกรรม | `dtmain`, `dtdn`, `dttm` |
| นัดหมาย | `oapp`, `oapp_cancel` |
| คิว/สล็อต | `opd_queue_schedule`, `opd_queue_slot`, `opd_queue_slot_type`, `opd_qs_slot_summary`, `opd_qs_location`, `opd_qs_limit_type` |
| ส่งต่อ | `referout`, `referin` |
| การเงิน | `income`, `paidst`, `pttype`, `rcpt_print`, `rcpt_debt` |
| ทะเบียนอ้างอิง | `doctor`, `ward`, `roomno`, `bedno`, `spclty`, `kskdepartment`, `clinic`, `icd101`, `hospcode`, `epi_vaccine` |
| PCU ประชากร | `person`, `village`, `house`, `person_chronic`, `person_vaccine`, `person_death`, `person_screen_head`, `person_screen_result`, `clinicmember`, `surveil_member` |
| PCU ฝากครรภ์ | `person_anc`, `person_anc_service`, `person_labour` |
| PCU เด็ก/วัคซีน | `person_wbc`, `person_wbc_service`, `person_epi`, `person_epi_vaccine`, `person_epi_nutrition` |
| PCU อนามัยโรงเรียน | `village_student` |
| PCU อนามัยสตรี | `person_women`, `person_women_service` |
| แพทย์แผนไทย | `health_med_service` (+ อีก 8 ตาราง เอกสารไม่ระบุชื่อ) |
| กายภาพบำบัด | `physic_main`, `physic_main_ipd`, `physic_member`, `physic_pe`, `physic_pt_send` |
| สิทธิการรักษา | `visit_pttype`, `ipt_pttype_check`, `ipt_pttype_income_cover` |
| Doctor Workbench | `opdscreen_doctor_pe`, `ptnote`, `patient_condition` (+ อีก 11 ตาราง) |
| แพ้ยา / คำสั่งแพทย์ IPD | `opd_allergy`, `ipd_doctor_order`, `ipd_nurse_note` |

## ตัวอย่าง join ที่ใช้ได้จริง

```sql
-- 1) ผู้ป่วยหนึ่งคน + ประวัติ OPD ล่าสุด พร้อมชื่อแพทย์และแผนก
SELECT p.hn, p.pname, p.fname, p.lname,
       o.vn, o.vstdate, o.vsttime,
       d.name AS doctor_name, k.department
FROM patient p
JOIN ovst o ON o.hn = p.hn
JOIN doctor d ON d.code = o.doctor
JOIN kskdepartment k ON k.depcode = o.cur_dep
WHERE p.hn = ?
ORDER BY o.vstdate DESC, o.vsttime DESC
LIMIT 20;

-- 2) คำสั่งตรวจแล็บของ OPD visit หนึ่งครั้ง (สังเกตคีย์ join ของ lab)
SELECT o.vn, o.hn, o.vstdate, lh.lab_order_number
FROM ovst o
JOIN lab_head lh ON lh.vn = o.vn
JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number
WHERE o.vn = ?
LIMIT 50;

-- 3) ผู้ป่วยที่ยังนอนรักษาตัวอยู่
SELECT p.hn, p.pname, p.fname, p.lname, i.an, i.regdate
FROM patient p
JOIN ipt i ON i.hn = p.hn
WHERE i.dchdate IS NULL
ORDER BY i.regdate DESC
LIMIT 20;
```

ใส่ `LIMIT` เสมอ และ bind พารามิเตอร์ ห้ามต่อ string จากผู้ใช้เข้ากับ SQL ตรงๆ

## วิธีหาตารางเมื่อไม่รู้ว่าอยู่ไหน

1. `SHOW TABLES LIKE '%คำค้น%'` — ไม่ถึงวินาที ลองทั้งคำอังกฤษและคำย่อ (`screen`, `lab`, `drug`, `diag`, `visit`, `person`, `an`, `opd`, `ipd`, `anc`, `epi`)
2. เดาชื่อไม่ออก ให้ค้นจากชื่อคอลัมน์แทน — ช้า 5-10 วินาที ใส่ `LIMIT` ทุกครั้ง
   ```sql
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = DATABASE() AND column_name LIKE '%คำค้น%' LIMIT 30;
   ```
3. `SHOW COLUMNS` ยืนยันก่อนเขียน query จริง
4. ก่อน join สองตาราง ดูคอลัมน์ทั้งคู่ให้ครบ แล้วเลือกคีย์ที่ชื่อตรงกันจริงๆ
5. `SHOW TABLES` แล้วไม่มี = โรงพยาบาลนี้ไม่ได้ใช้ ให้เลี่ยงไปตารางอื่น

## กับดักที่ตรวจพบจากฐานจริง

ยืนยันกับฐาน `hos_07547` (MySQL) แล้ว — คอลัมน์ตามสเปกข้างบนมีครบทุกตัว แต่มีเรื่องที่สเปกไม่ได้บอก:

- **ตารางจริงกว้างกว่าสเปกมาก** — `patient` 101 คอลัมน์, `ipt` 100, `lab_head` 81, `doctor` 63, `kskdepartment` 58 ขณะที่สเปกระบุแค่ 4-16 ตัว อย่าคิดว่ารายการข้างบนคือทั้งหมด
- **`sex` มี NULL และสตริงว่างปนอยู่** (4 แถวจาก 6,615) — `WHERE sex = '1' OR sex = '2'` ทิ้งแถวเหล่านี้เงียบๆ
- **รหัสในตารางข้อมูลไม่ได้อยู่ในทะเบียนเสมอ** — ฐานนี้มี dx ที่ไม่มีใน `icd101` ถึง 3.6% (11,825 จาก 326,572 แถว) รวมรหัสที่คีย์ผิดชัดๆ อย่าง `ผ018` ที่ถูกคีย์ 20 ครั้งในวันเดียว  **ก่อนสรุปผลจากรหัสใดๆ ให้ join `icd101` ดูชื่อโรคก่อน** รหัสที่ไม่มีในทะเบียนคือข้อมูลคีย์ผิด ไม่ใช่ข้อค้นพบ
- **หมวดของยาอยู่ที่คอลัมน์ธง ไม่ใช่ช่วง icode** — เช่น ยาแผนไทยดูที่ `drugitems.ttmt_code` (ไม่ว่าง = เป็นยาแผนไทย) ส่วน `นวดแผนไทย`/`อบสมุนไพร`/`ลูกประคบ` เป็น **หัตถการ** ใน `opitemrece` ไม่ใช่ยา  ห้ามเขียนรายการ `icode IN (...)` ขึ้นมาเอง
- **วันที่เป็น ค.ศ.** — ต้องแปลงเองถ้าผู้ใช้พูดเป็น พ.ศ. (`+543`)
- หลาย รพ. ยังรัน MySQL 5.x — เลี่ยง CTE และ window function ถ้าไม่จำเป็น

## แหล่งที่มา

- https://bms-session-dev.bmscloud.in.th/chapters/hosxp-tables.html (ทบทวนล่าสุด 2026-08-17)
- บทที่เกี่ยวข้องในเอกสารเดียวกัน: `01-endpoints.md` (endpoint + envelope), `02-data-types.md` (field type code, ตาราง/ฟิลด์ต้องห้าม), `02-guides/01-sql-queries.md` (การ bind พารามิเตอร์, ความต่างระหว่างฐานข้อมูล), `02-guides/02-rest-crud.md`
