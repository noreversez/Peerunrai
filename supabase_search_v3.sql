-- ============================================================
-- SQL สำหรับสร้าง RPC Function: search_users_v3
-- นำไปรันใน Supabase > SQL Editor
-- ============================================================

-- สร้าง GIN Index (ทำแค่ครั้งแรกครั้งเดียว) เพื่อความเร็วสูงสุด
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_norm_first ON public.users USING gin (norm_first gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last  ON public.users USING gin (norm_last  gin_trgm_ops);

-- สร้างฟังก์ชันค้นหาเวอร์ชันที่ดีที่สุด (รองรับ Dual-Normalization และเช็ครุ่นอัตโนมัติ)
CREATE OR REPLACE FUNCTION search_users_v3(
  raw_tokens text[]
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
  t_old      text;
  nt         text;
  is_num     boolean;
  i          int := 0;
BEGIN
  -- วนลูปตามคำค้นหาที่ส่งเข้ามา
  FOREACH t IN ARRAY raw_tokens LOOP
    i := i + 1;
    
    -- 1. สร้าง t_old (ลบสระออกอย่างเดียว)
    t_old := regexp_replace(t, '[่้๊๋็์ิีึืุูเแโใไัาอ]', '', 'g');
    
    -- 2. สร้าง nt (แปลงตัวอักษรแบบเข้มงวด)
    nt := regexp_replace(t_old, '[ขฃคฅฆ]', 'ก', 'g');
    nt := regexp_replace(nt, '[จฉชซฌศษส]', 'จ', 'g');
    nt := regexp_replace(nt, '[ฎฏฐฑฒดตถทธ]', 'ด', 'g');
    nt := regexp_replace(nt, '[บปผฝพฟภ]', 'บ', 'g');
    nt := regexp_replace(nt, '[ญย]', 'ย', 'g');
    nt := regexp_replace(nt, '[รลฬ]', 'ร', 'g');
    nt := regexp_replace(nt, '[ณน]', 'น', 'g');
    
    -- 3. เช็คว่าเป็นตัวเลขหรือไม่
    is_num := t ~ '^[0-9]+$';

    -- สร้างเงื่อนไข WHERE (ค้นหาครอบคลุมทั้ง 2 รูปแบบ)
    IF length(nt) < 3 THEN
      sql_where := sql_where || format(
        ' AND (norm_first ILIKE %L OR norm_last ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L',
        nt || '%', nt || '%', t_old || '%', t_old || '%'
      );
    ELSE
      sql_where := sql_where || format(
        ' AND (norm_first ILIKE %L OR norm_last ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L',
        '%' || nt || '%', '%' || nt || '%', '%' || t_old || '%', '%' || t_old || '%'
      );
    END IF;

    -- ถ้าเป็นตัวเลข ให้ค้นหารุ่นด้วย
    IF is_num THEN
      sql_where := sql_where || format(' OR generation = %L)', t);
    ELSE
      sql_where := sql_where || ')';
    END IF;

    -- สร้างระบบให้คะแนน (Scoring) เพื่อดึงคนที่แม่นที่สุดขึ้นก่อน
    sql_score := sql_score || format(
      ' + CASE WHEN generation = %L THEN 100 ELSE 0 END'
      || ' + CASE WHEN norm_last = %L OR norm_last = %L THEN 900 WHEN norm_last ILIKE %L THEN 500 ELSE 0 END'
      || ' + CASE WHEN norm_first = %L OR norm_first = %L THEN 800 WHEN norm_first ILIKE %L THEN 400 ELSE 0 END',
      t,
      nt, t_old, nt || '%',
      nt, t_old, nt || '%'
    );
  END LOOP;

  -- รันคำสั่ง SQL
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
