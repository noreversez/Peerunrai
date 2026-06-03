-- ============================================================
-- วิ่งสคริปต์นี้ใน Supabase SQL Editor (Run Once)
-- จะสร้าง / แทนที่ฟังก์ชันค้นหา All-in-One ที่รวดเร็วที่สุด
-- ============================================================

-- 1. ตรวจสอบว่ามี extension pg_trgm หรือยัง
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. สร้าง GIN index บน norm_first และ norm_last (ถ้ายังไม่มี)
CREATE INDEX IF NOT EXISTS idx_users_norm_first ON public.users USING gin (norm_first gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last  ON public.users USING gin (norm_last  gin_trgm_ops);

-- 3. ฟังก์ชัน All-in-One: Exact + Fuzzy ในครั้งเดียว ไม่ต้อง round-trip 2 รอบ
--    รับ tokens[] และ use_fuzzy flag
--    คืนค่าพร้อม relevance score เพื่อเรียงลำดับที่ DB (เร็วที่สุด)
CREATE OR REPLACE FUNCTION search_users_v2(
  search_tokens  text[],
  use_fuzzy      boolean DEFAULT false,
  fuzzy_threshold real    DEFAULT 0.25
)
RETURNS TABLE (
  id          bigint,
  first_name  text,
  last_name   text,
  generation  text,
  norm_first  text,
  norm_last   text,
  score       real
)
LANGUAGE plpgsql
AS $$
DECLARE
  sql_where  text := '';
  sql_score  text := '0';
  t          text;
  i          int  := 0;
BEGIN
  FOREACH t IN ARRAY search_tokens LOOP
    i := i + 1;
    -- WHERE: ตรงเป๊ะ (like) หรือ fuzzy (similarity %)
    IF use_fuzzy THEN
      sql_where := sql_where || format(
        ' AND (norm_first ILIKE %L OR norm_last ILIKE %L OR norm_first %% %L OR norm_last %% %L OR generation = %L)',
        '%' || t || '%', '%' || t || '%', t, t, t
      );
    ELSE
      sql_where := sql_where || format(
        ' AND (norm_first ILIKE %L OR norm_last ILIKE %L OR generation = %L)',
        '%' || t || '%', '%' || t || '%', t
      );
    END IF;

    -- SCORE: ให้คะแนนที่ DB เลย
    sql_score := sql_score || format(
      ' + CASE WHEN generation = %L THEN 100 ELSE 0 END'
      || ' + CASE WHEN norm_first = %L THEN 90 WHEN norm_first ILIKE %L THEN 80 WHEN norm_first ILIKE %L THEN 40 ELSE 0 END'
      || ' + CASE WHEN norm_last  = %L THEN 70 WHEN norm_last  ILIKE %L THEN 60 WHEN norm_last  ILIKE %L THEN 30 ELSE 0 END',
      t,
      t, t || '%', '%' || t || '%',
      t, t || '%', '%' || t || '%'
    );
  END LOOP;

  RETURN QUERY EXECUTE format(
    'SELECT id, first_name, last_name, generation, norm_first, norm_last, (%s)::real AS score
     FROM public.users
     WHERE 1=1 %s
     ORDER BY score DESC
     LIMIT 300',
    sql_score, sql_where
  );
END;
$$;
