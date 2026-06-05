-- ============================================================
-- รัน script นี้ใน Supabase SQL Editor (ครั้งเดียว)
-- สร้างตารางเก็บสถิติผู้เข้าชมเว็บไซต์ และฟังก์ชันเพิ่มยอดอัตโนมัติ
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pageviews (
  date date PRIMARY KEY,
  views int NOT NULL DEFAULT 0
);

-- (optional) RLS: ปิดไว้ก่อนเพื่อให้ API เขียน/อ่านได้ง่าย
ALTER TABLE public.pageviews DISABLE ROW LEVEL SECURITY;

-- สร้างฟังก์ชันสำหรับการนับยอดวิว (+1) เพื่อป้องกัน Race Condition
CREATE OR REPLACE FUNCTION increment_pageview()
RETURNS void AS $$
BEGIN
  INSERT INTO public.pageviews (date, views)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (date) DO UPDATE SET views = pageviews.views + 1;
END;
$$ LANGUAGE plpgsql;
