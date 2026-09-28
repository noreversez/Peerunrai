-- ============================================================
-- เพดานค้นหารายวันต่อ IP (กัน scraping แบบยิงช้า ๆ เนียน ๆ ทั้งวัน)
--
-- ทำไมต้องเก็บใน DB แทนหน่วยความจำ: Vercel serverless function
-- รีเซ็ตหน่วยความจำเป็นระยะ (cold start) ไม่มีทางถือค่านับได้ครบ 24 ชม.
-- แน่นอน ต้องเก็บถาวรใน DB ถึงจะนับสะสมได้แม่นยำจริงทั้งวัน
--
-- วิธีติดตั้ง: รันไฟล์นี้ทั้งไฟล์ใน Supabase > SQL Editor (รันซ้ำได้)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.search_rate_daily (
  ip    text NOT NULL,
  day   date NOT NULL,
  count int  NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, day)
);

-- ปิด RLS ไว้ก่อนเช่นเดียวกับตารางอื่น ๆ ที่ backend เขียนผ่าน service_role
-- (สอดคล้องกับสถานะปัจจุบันของตารางอื่นทั้งหมด — ถ้าจะเปิด RLS ทีหลัง ควรทำพร้อมกันทั้งชุด
-- หลังยืนยันแล้วว่า SUPABASE_SERVICE_KEY ที่ตั้งไว้เป็น service_role จริง)
ALTER TABLE public.search_rate_daily DISABLE ROW LEVEL SECURITY;

-- นับ+เพิ่มค่าแบบอะตอมมิกในคำสั่งเดียว (กัน race condition เวลามีหลาย request พร้อมกัน)
-- คืนค่าจำนวนครั้งสะสมของ IP นั้นในวันนี้ (เขตเวลาไทย) หลังเพิ่มแล้ว
CREATE OR REPLACE FUNCTION increment_daily_search_count(p_ip text)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO public.search_rate_daily (ip, day, count)
  VALUES (p_ip, (now() AT TIME ZONE 'Asia/Bangkok')::date, 1)
  ON CONFLICT (ip, day) DO UPDATE SET count = search_rate_daily.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- (ทางเลือก) ลบข้อมูลเก่าเกิน 30 วันเป็นระยะ กันตารางบวม — รันเองเป็นครั้งคราวได้ ไม่จำเป็นต้องอัตโนมัติ
-- DELETE FROM public.search_rate_daily WHERE day < (now() AT TIME ZONE 'Asia/Bangkok')::date - 30;

-- ทดสอบ: SELECT increment_daily_search_count('1.2.3.4');  -- เรียกซ้ำดูค่าจะเพิ่มทีละ 1
