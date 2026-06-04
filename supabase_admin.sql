-- ============================================================
-- สร้างตาราง changelogs สำหรับระบบ Admin แก้ไข Changelog
-- นำไปรันใน Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.changelogs (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL DEFAULT 'new',  -- new / fix / improve
  version_date text NOT NULL,               -- วันที่แสดง เช่น "4 มิ.ย. 2569"
  description text NOT NULL,               -- รายละเอียด
  sort_order  int  DEFAULT 0,              -- เรียงลำดับ (น้อย = ขึ้นบน)
  is_visible  boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelogs_sort ON public.changelogs (sort_order, created_at DESC);

-- เพิ่มข้อมูลเริ่มต้น (ตรงกับที่ hardcode ไว้ใน HTML)
INSERT INTO public.changelogs (type, version_date, description, sort_order) VALUES
  ('new',     '4 มิ.ย. 2569', 'เพิ่มโลโก้ "พี่รุ่นไรน้อง" และเมนูแจ้งปัญหา / อัปเดท', 1),
  ('fix',     '4 มิ.ย. 2569', 'ปรับปรุงระบบค้นหาให้ค้นหาชื่อ-สกุลสั้นๆ ได้แม่นยำขึ้น (เช่น เกปัน, บาซิล)', 2),
  ('improve', '3 มิ.ย. 2569', 'ระบบ Ranking Score ใหม่ — ผลลัพธ์ที่ตรงกว่าจะขึ้นก่อนเสมอ', 3),
  ('new',     '3 มิ.ย. 2569', 'เพิ่มอนิเมชั่นหิมะตกและ Hint Tags สำหรับ "ธราธิป", "จันทวงศ์", "รุ่น 79"', 4),
  ('fix',     '2 มิ.ย. 2569', 'แก้บัคบอทไม่ตอบกลับเมื่อค้นหาคำสั้น (Vercel Timeout)', 5),
  ('new',     '1 มิ.ย. 2569', 'เปิดตัวระบบ Peerunrai — ค้นหา นรต. ผ่าน LINE Bot และเว็บไซต์', 6);

-- RLS
ALTER TABLE public.changelogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read visible changelogs"
  ON public.changelogs FOR SELECT USING (is_visible = true);
