-- Extension required for partial string search (trigram)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Create table for Users (รายชื่อ นรต.)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  generation text NOT NULL,
  rank text,
  location text,
  norm_first text,
  norm_last text,
  norm_rank text,
  norm_location text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- สร้าง Indexes แบบ Trigram เพื่อให้ค้นหาข้อความบางส่วนด้วย ilike (หรือ like) ได้เร็วระดับมิลลิวินาที
CREATE INDEX IF NOT EXISTS idx_users_norm_first ON public.users USING gin (norm_first gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last ON public.users USING gin (norm_last gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_generation ON public.users (generation);

-- 2. Create table for Members (ผู้ใช้งาน LINE ที่ลงทะเบียนแล้ว)
CREATE TABLE IF NOT EXISTS public.members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  line_user_id text UNIQUE NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  generation text NOT NULL,
  status text DEFAULT 'active',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- สร้าง Index สำหรับค้นหาผู้ใช้จาก LINE User ID ให้เร็วที่สุด
CREATE INDEX IF NOT EXISTS idx_members_line_user_id ON public.members (line_user_id);

-- 3. Create table for Registration States (ใช้แทน CacheService)
CREATE TABLE IF NOT EXISTS public.reg_states (
  line_user_id text PRIMARY KEY,
  step text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create table for Config (ตั้งค่าระบบเหมือนใน Google Sheets)
CREATE TABLE IF NOT EXISTS public.config (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text
);

-- นำเข้าการตั้งค่าเริ่มต้น
INSERT INTO public.config (key, value, description) VALUES
('registration_enabled', 'TRUE', 'เปิด (TRUE) / ปิด (FALSE) ระบบสมัครสมาชิก'),
('access_mode', 'MEMBER_ONLY', 'โหมดการใช้งาน: MEMBER_ONLY = ต้องสมัครก่อน, PUBLIC = ใช้ได้เลย')
ON CONFLICT (key) DO NOTHING;
