-- ============================================================
-- สร้างตาราง reports สำหรับเก็บข้อมูลการแจ้งปัญหา
-- นำไปรันใน Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reports (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,           -- ประเภท: name, gen, missing, other
  name        text,                    -- ชื่อ-สกุลที่เกี่ยวข้อง
  detail      text NOT NULL,           -- รายละเอียด / ข้อมูลที่ถูกต้อง
  contact     text,                    -- ช่องทางติดต่อกลับ
  status      text DEFAULT 'pending',  -- pending / reviewed / resolved
  created_at  timestamptz DEFAULT now()
);

-- Index สำหรับดูงาน
CREATE INDEX IF NOT EXISTS idx_reports_status     ON public.reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports (created_at DESC);

-- Row Level Security (ป้องกันคนอ่าน/แก้ไขตรงจาก Client)
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- อนุญาตให้ Service Role เขียนได้อย่างเดียว (API ของเราใช้ Service Role)
CREATE POLICY "Service role can insert reports"
  ON public.reports FOR INSERT
  WITH CHECK (true);
