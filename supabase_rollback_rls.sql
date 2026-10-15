-- ============================================================
-- ROLLBACK: ปิด RLS กลับ เพราะ SUPABASE_SERVICE_KEY ที่ตั้งไว้ใน Vercel
-- ไม่ใช่ service_role key จริง (ค้นหาบนเว็บคืนค่า total=0 หลังเปิด RLS)
--
-- รันไฟล์นี้ทั้งไฟล์ทันทีเพื่อคืนระบบให้ใช้งานได้ปกติก่อน
-- แล้วค่อยไปแก้ค่า SUPABASE_SERVICE_KEY ใน Vercel ให้ถูกต้องทีหลัง
-- (ดูวิธีใน supabase_enable_rls.sql เพื่อกลับมาเปิดใหม่ทีหลัง)
-- ============================================================

ALTER TABLE public.reports     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.members     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pageviews   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reg_states  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.changelogs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_rate_daily  DISABLE ROW LEVEL SECURITY;

-- ตรวจสอบ: ทุกแถวต้องเป็น rowsecurity = false
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
