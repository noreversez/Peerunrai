-- ============================================================
-- ปิดคำเตือน "RLS Disabled in Public" (CRITICAL) จาก Supabase Security Advisor
--
-- ⚠️⚠️⚠️ ทำตามลำดับนี้เท่านั้น มิฉะนั้นเว็บ/บอทจะพัง ⚠️⚠️⚠️
--
--   ขั้นที่ 0 (ด่านตรวจ — ต้องผ่านก่อนเสมอ):
--     เรียก GET /api/admin?action=key-diagnostics พร้อม header x-admin-password
--     (พิมพ์รหัสในเทอร์มินัลของคุณเอง ห้ามส่งในแชท) ผลต้องเป็น  "rlsSafe": true
--     ถ้าเป็น false แปลว่าค่าใน SUPABASE_SERVICE_KEY ไม่ใช่ service_role
--     (เคยเกิดแล้วในการเปิด RLS รอบแรก: ค้นหาได้ total=0 ทั้งเว็บ ต้อง rollback)
--     → ไปขั้นที่ 1 แล้วกลับมาตรวจใหม่ จนกว่าจะได้ true
--
--   ขั้นที่ 1 (แก้คีย์ ถ้าขั้นที่ 0 ได้ false):
--     Supabase Dashboard > Project Settings > API
--     คัดลอกค่า "service_role" secret (หรือ "secret" key ในรูปแบบใหม่ — อยู่คนละช่องกับ anon/publishable)
--     Vercel > โปรเจกต์ Peerunrai > Settings > Environment Variables
--     แก้ตัวแปร SUPABASE_SERVICE_KEY ให้เป็นค่านั้น (Production + Preview) แล้ว Redeploy
--
--   ขั้นที่ 2:
--     รันไฟล์นี้ทั้งไฟล์ใน Supabase SQL Editor
--
--   ขั้นที่ 3 (ยืนยันหลังรัน):
--     ค้นหาบนเว็บด้วยคำใหม่ที่ไม่เคยค้น (cache ฝั่งเซิร์ฟเวอร์เก็บผล 5 นาที อาจหลอกตา)
--     ถ้า total=0 ผิดปกติ → รัน supabase_rollback_rls.sql ทันที แล้วไปตรวจขั้นที่ 0-1
--
-- ทำไมปลอดภัย: ทุก endpoint (api/*.js) เชื่อมต่อ Supabase ด้วย
-- SUPABASE_SERVICE_KEY (service_role) ซึ่ง "ข้าม" RLS เสมอไม่ว่าจะเปิดหรือปิด
-- ระบบจึงทำงานเหมือนเดิมทุกอย่างหลังรันไฟล์นี้ — สิ่งที่เปลี่ยนคือปิดช่องทาง
-- เข้าถึงข้อมูลตรง ๆ ผ่าน anon key (กรณีหลุด/ถูกใช้ผิดที่) เท่านั้น
-- ============================================================

-- 0) ตรวจสอบ policy เดิมที่ค้างอยู่ก่อน (Advisor แจ้งว่า public.reports มี policy
--    ค้างอยู่ทั้งที่ RLS ปิด — รันดูก่อนว่า policy นั้นเขียนว่าอะไร)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- 1) เปิด Row Level Security ให้ทุกตารางใน public
ALTER TABLE public.reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pageviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reg_states         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelogs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_rate_daily  ENABLE ROW LEVEL SECURITY;

-- ไม่ต้องสร้าง policy เพิ่มเติม — service_role ที่ backend ใช้ข้าม RLS อยู่แล้วเสมอ
-- การไม่มี policy ใด ๆ = ปฏิเสธ anon/authenticated key ทั้งหมดโดยอัตโนมัติ (ปลอดภัยสุด)
--
-- หมายเหตุ: ฟังก์ชัน RPC (search_users_v5, increment_pageview, get_search_analytics ฯลฯ)
-- ถูกเรียกด้วย service_role เช่นกัน จึงไม่ได้รับผลกระทบจากการเปิด RLS

-- 2) ตรวจสอบผลหลังรัน — ทุกแถวต้องเป็น rowsecurity = true
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
