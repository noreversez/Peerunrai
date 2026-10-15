# พี่รุ่นไรน้อง (Peerunrai)

ระบบค้นหารายชื่อ นรต. ผ่านเว็บและ LINE bot — พัฒนาโดยน้อง นรต.79
Vercel serverless (Node.js, ESM) + Supabase (Postgres) + LINE Messaging API

- เว็บ: `https://peerunrai.vercel.app` (หน้าค้นหา `public/index.html`, หลังบ้าน `/admin`)
- ไม่มี build step — Vercel เสิร์ฟ `public/` และรัน `api/*.js` เป็น serverless function (region `sin1`)

## โครงสร้าง

| พาธ | หน้าที่ |
|---|---|
| `api/search.js` | API ค้นหาของเว็บ (rate limit 20/นาที + โควตา 400/วัน ต่อ IP) |
| `api/webhook.js` | LINE webhook: ข้อความ, postback, follow (ตรวจลายเซ็น + rate limit 100/นาที) |
| `api/admin.js` | หลังบ้าน: รายงานปัญหา, changelog, จัดการรายชื่อ, สถิติ, audit log, `key-diagnostics` |
| `api/changelogs.js`, `report.js`, `pageview.js` | endpoint สาธารณะเล็ก ๆ ของหน้าเว็บ |
| `utils/search.js` | tokenize + เรียก RPC `search_users_v5` (มี fallback เดิมถ้า RPC ยังไม่ติดตั้ง) |
| `utils/line.js` | ส่งข้อความ LINE, flex card ผลค้นหา/ต้อนรับ, ตรวจลายเซ็น |
| `utils/ratelimit.js`, `cache.js` | rate limit และ cache แบบ in-memory (best-effort ต่อ instance) |
| `public/line-banner.jpg`, `icon-search.png` | รูปที่การ์ด LINE อ้างถึง (โฮสต์เอง ไม่พึ่งเว็บภายนอก) |

## ตัวแปรสภาพแวดล้อม (Vercel > Settings > Environment Variables)

| ตัวแปร | ใช้ทำอะไร | หมายเหตุ |
|---|---|---|
| `SUPABASE_URL` | URL โปรเจกต์ Supabase | |
| `SUPABASE_SERVICE_KEY` | คีย์ที่ backend ใช้ | **ต้องเป็น service_role/secret key** ตรวจด้วย `key-diagnostics` |
| `SUPABASE_KEY` | คีย์สำรอง (anon) | ไม่ถูกใช้เมื่อมี `SUPABASE_SERVICE_KEY` ลบทิ้งได้ |
| `ADMIN_PASSWORD` | รหัสหลังบ้าน | ถ้าไม่ตั้ง หลังบ้านจะปิดทั้งหมด (fail-closed) |
| `LINE_ACCESS_TOKEN` | ให้เซิร์ฟเวอร์ตอบกลับไปหา LINE | Channel access token (แท็บ Messaging API) |
| `LINE_CHANNEL_SECRET` | ตรวจว่า webhook มาจาก LINE จริง | Channel secret (แท็บ Basic settings) — คนละตัวกับ access token |

## ติดตั้งฐานข้อมูล (Supabase > SQL Editor) — เรียงตามลำดับ

ไฟล์ทั้งหมดรันซ้ำได้ (idempotent)

1. `supabase_schema.sql` — ตาราง `users` (และตารางเก่า `members`, `reg_states`, `config` ที่โค้ดปัจจุบันไม่ได้ใช้)
2. `supabase_search_logs.sql`, `supabase_pageviews.sql`, `supabase_reports.sql`, `supabase_admin.sql` (changelogs)
3. `supabase_search_v5.sql` — ฟังก์ชันค้นหาหลัก + normalize + index + คอลัมน์ `is_active` (**ตัวจริงของระบบค้นหา**)
4. `supabase_admin_users.sql` — `admin_audit` + หาชื่อซ้ำ
5. `supabase_search_analytics.sql` — สถิติการค้นหาในหน้า admin
6. `supabase_daily_search_quota.sql` — โควตาค้นหารายวัน
7. `supabase_enable_rls.sql` — เปิด RLS (**อ่านขั้นตอนหัวไฟล์ก่อน** ต้องผ่านด่าน `key-diagnostics`)
   ถ้าเว็บพัง: `supabase_rollback_rls.sql`

## ตรวจชนิดของ Supabase key (ไม่เปิดเผยค่าคีย์)

```bash
curl -H "x-admin-password: <รหัสของคุณ>" "https://peerunrai.vercel.app/api/admin?action=key-diagnostics"
```

ต้องได้ `"rlsSafe": true` ก่อนจะเปิด RLS

## ความปลอดภัย — สถานะ

- LINE webhook: ตรวจ `x-line-signature` (เปิดแล้ว), rate limit
- Admin: fail-closed, รับรหัสทาง header เท่านั้น, เทียบแบบ constant-time, จำกัดการลองรหัส
- Search API: rate limit ต่อนาที + โควตารายวัน (นับใน DB), กรองอักขระอันตรายก่อนถึง DB
- ยังค้าง: เปิด RLS (รอยืนยันคีย์), Content-Security-Policy, โดเมนของตัวเอง + Cloudflare
- Dependency: ตรวจด้วย `npm audit` เป็นระยะ

## หมายเหตุสำหรับคนที่กลับมาพัฒนาต่อ

- cache ผลค้นหาฝั่งเซิร์ฟเวอร์ 5 นาที — ทดสอบหลังแก้ DB ให้ใช้คำค้นใหม่ที่ไม่เคยค้น ไม่งั้นอาจเห็นผลเก่า
- ไฟล์ SQL เวอร์ชันเก่า (v2–v4, fuzzy, fix_normalize) ถูกลบแล้ว ดูย้อนหลังได้จาก git history
- รูปโลโก้หน้าเว็บ/แอดมิน/manifest ยังโฮสต์ที่ pic.in.th (ควรย้ายมาไว้ใน `public/` เช่นกัน)
- รูป flaticon ไอคอนแว่นขยาย (`public/icon-search.png`) ใช้ตามสัญญาอนุญาตฟรีของ Flaticon ซึ่งต้องให้เครดิตผู้สร้าง
