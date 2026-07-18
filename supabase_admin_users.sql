-- ============================================================
-- ระบบจัดการรายชื่อ นรต. จากหน้า Admin
-- - ตาราง admin_audit: บันทึกว่าใครแก้/ลบ/เพิ่ม อะไร เมื่อไหร่
-- - ฟังก์ชัน find_duplicate_users: หาชื่อที่ซ้ำกัน (ชื่อ+สกุล+รุ่น ตรงกัน)
--
-- วิธีติดตั้ง: รัน supabase_search_v5.sql (เวอร์ชันล่าสุด มี is_active) ก่อน
--             แล้วค่อยรันไฟล์นี้ทั้งไฟล์ใน Supabase > SQL Editor (รันซ้ำได้)
-- ============================================================

-- ── ตารางบันทึกประวัติการแก้ไขของ Admin ──
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id         bigserial PRIMARY KEY,
  action     text        NOT NULL,             -- create | update | archive | restore | merge
  target_id  uuid,                             -- id ของ นรต. ที่ถูกกระทำ
  detail     jsonb       NOT NULL DEFAULT '{}',-- snapshot ก่อน/หลัง
  actor      text        NOT NULL DEFAULT 'admin',
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON public.admin_audit (created_at DESC);
ALTER TABLE public.admin_audit DISABLE ROW LEVEL SECURITY;

-- ── ฟังก์ชันหาชื่อซ้ำ (ชื่อ + นามสกุล + รุ่น ตรงกันเป๊ะ) เฉพาะคนที่ยังใช้งานอยู่ ──
CREATE OR REPLACE FUNCTION find_duplicate_users()
RETURNS TABLE (
  first_name  text,
  last_name   text,
  generation  text,
  cnt         int,
  ids         uuid[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT first_name, last_name, generation,
         count(*)::int AS cnt,
         array_agg(id ORDER BY created_at) AS ids
  FROM public.users
  WHERE is_active
  GROUP BY first_name, last_name, generation
  HAVING count(*) > 1
  ORDER BY count(*) DESC, first_name
  LIMIT 200;
$$;

-- ทดสอบ: SELECT * FROM find_duplicate_users();
