-- ============================================================
-- ปิดคำเตือน "RLS Disabled in Public" (CRITICAL) จาก Supabase Security Advisor
--
-- ⚠️⚠️⚠️ ทำตามลำดับนี้เท่านั้น มิฉะนั้นเว็บ/บอทจะพัง ⚠️⚠️⚠️
--
--   ขั้นที่ 1 (ทำก่อนเสมอ แม้คิดว่าตั้งไว้แล้ว):
--     เปิด Supabase Dashboard > Project Settings > API
--     คัดลอกค่า "service_role" secret (อยู่คนละช่องกับ "anon public")
--     ไปที่ Vercel > โปรเจกต์ Peerunrai > Settings > Environment Variables
--     ตั้ง/อัปเดตตัวแปร SUPABASE_SERVICE_KEY ให้เป็นค่านั้น (Production + Preview)
--     แล้วกด Redeploy รอ deploy เสร็จก่อน
--
--   ขั้นที่ 2:
--     รันไฟล์นี้ทั้งไฟล์ใน Supabase SQL Editor
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

-- 1) เปิด Row Level Security ให้ทุกตารางที่ Advisor แจ้งเตือน
ALTER TABLE public.reports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pageviews   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reg_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;

-- ไม่ต้องสร้าง policy เพิ่มเติม — service_role ที่ backend ใช้ข้าม RLS อยู่แล้วเสมอ
-- การไม่มี policy ใด ๆ = ปฏิเสธ anon/authenticated key ทั้งหมดโดยอัตโนมัติ (ปลอดภัยสุด)

-- 2) ตรวจสอบผลหลังรัน — ทุกแถวต้องเป็น rowsecurity = true
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
