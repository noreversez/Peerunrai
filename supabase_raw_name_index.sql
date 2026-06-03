-- ============================================================
-- รัน script นี้ใน Supabase SQL Editor
-- เพิ่ม GIN Index บน first_name และ last_name ต้นฉบับ
-- เพื่อให้ค้นหาชื่อจริงได้เร็ว แม้ norm ยังไม่ถูก update
-- ============================================================

-- GIN trigram index บน first_name (ชื่อต้นฉบับ)
CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm
  ON public.users USING gin (first_name gin_trgm_ops);

-- GIN trigram index บน last_name (นามสกุลต้นฉบับ)
CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm
  ON public.users USING gin (last_name gin_trgm_ops);

-- B-tree index บน generation (ค้นหาเลขรุ่น)
CREATE INDEX IF NOT EXISTS idx_users_generation
  ON public.users (generation);

-- ตรวจสอบ index ทั้งหมด
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'users'
ORDER BY indexname;
