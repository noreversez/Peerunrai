-- ============================================================
-- รัน script นี้ใน Supabase SQL Editor (ครั้งเดียว)
-- สร้างตารางบันทึกประวัติการค้นหา
-- ============================================================

CREATE TABLE IF NOT EXISTS public.search_logs (
  id            bigserial PRIMARY KEY,
  user_id       text        NOT NULL,           -- LINE User ID
  keyword       text        NOT NULL,           -- คำที่ค้นหา (ต้นฉบับ)
  results_count int         NOT NULL DEFAULT 0, -- จำนวนผลลัพธ์ที่พบ
  searched_at   timestamptz NOT NULL DEFAULT now()
);

-- Index สำหรับดึงประวัติของผู้ใช้แต่ละคน (เรียงใหม่สุดก่อน)
CREATE INDEX IF NOT EXISTS idx_search_logs_user
  ON public.search_logs (user_id, searched_at DESC);

-- Index สำหรับ Admin ดูว่าคำไหนถูกค้นหาบ่อยสุด
CREATE INDEX IF NOT EXISTS idx_search_logs_keyword
  ON public.search_logs (keyword);

-- (optional) RLS: ปิดไว้ก่อนเพื่อให้ API เขียนได้
ALTER TABLE public.search_logs DISABLE ROW LEVEL SECURITY;
