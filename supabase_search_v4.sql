-- ============================================================
-- SQL สำหรับสร้างระบบค้นหา All-in-One (Supabase RPC V4)
-- นำไปรันใน Supabase > SQL Editor
-- ============================================================

-- 1. สร้าง Extension สำหรับทำ Fuzzy Search / Trigram Match
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. สร้าง GIN Index (สำหรับการค้นหาแบบมี % นำหน้า หรือ Fuzzy Search)
CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm ON public.users USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm  ON public.users USING gin (last_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_first_trgm ON public.users USING gin (norm_first gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last_trgm  ON public.users USING gin (norm_last gin_trgm_ops);

-- 3. สร้าง B-Tree Index (สำหรับการค้นหาคำสั้นที่ไม่มี % นำหน้า ป้องกันระบบค้าง 10 วิ)
CREATE INDEX IF NOT EXISTS idx_users_first_name_prefix ON public.users (first_name varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_last_name_prefix  ON public.users (last_name varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_first_prefix ON public.users (norm_first varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last_prefix  ON public.users (norm_last varchar_pattern_ops);

-- 4. สร้างฟังก์ชันค้นหา All-in-One (search_users_v4)
CREATE OR REPLACE FUNCTION search_users_v4(
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
  -- ตั้งค่าความเข้มงวดของ Fuzzy Search (พิมพ์ผิดได้นิดหน่อย)
  SET pg_trgm.similarity_threshold = 0.3;

  FOREACH t IN ARRAY raw_tokens LOOP
    i := i + 1;
    
    -- สร้างคำค้นหาแบบที่ 1: ลบสระออก
    t_old := regexp_replace(t, '[่้๊๋็์ิีึืุูเแโใไัาอ]', '', 'g');
    
    -- สร้างคำค้นหาแบบที่ 2: แปลงพยัญชนะเสียงเดียวกัน (กฎเดียวกับ JavaScript 100%)
    nt := regexp_replace(t_old, '[ศษสซ]', 'ส', 'g');
    nt := regexp_replace(nt, '[ณน]', 'น', 'g');
    nt := regexp_replace(nt, '[ฬลร]', 'ล', 'g');
    nt := regexp_replace(nt, '[ญย]', 'ย', 'g');
    nt := regexp_replace(nt, '[ขฃคฅฆก]', 'ก', 'g');
    nt := regexp_replace(nt, '[พผภปบ]', 'พ', 'g');
    nt := regexp_replace(nt, '[ทธฐฒตถฎฏดฑ]', 'ต', 'g');
    nt := regexp_replace(nt, '[ชฉฌจ]', 'จ', 'g');
    
    is_num := t ~ '^[0-9]+$';

    -- [WHERE CLAUSE]: ตัดสินใจเลือกวิธีค้นหาเพื่อความเร็วสูงสุด
    IF length(t) < 3 THEN
      -- คำสั้น (1-2 ตัว): บังคับค้นหาจากด้านหน้า (Prefix) เพื่อใช้ B-Tree Index ป้องกันการเกิด Full Table Scan
      sql_where := sql_where || format(
        ' AND (first_name ILIKE %L OR last_name ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L',
        t || '%', t || '%', nt || '%', nt || '%', t_old || '%', t_old || '%'
      );
    ELSE
      -- คำยาว (3 ตัวขึ้นไป): ใช้ GIN Index ค้นหาได้ทุกที่ (Contains) + Fuzzy Search (สะกดผิด)
      sql_where := sql_where || format(
        ' AND (first_name ILIKE %L OR last_name ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L OR norm_first ILIKE %L OR norm_last ILIKE %L OR first_name %% %L OR last_name %% %L',
        '%' || t || '%', '%' || t || '%', '%' || nt || '%', '%' || nt || '%', '%' || t_old || '%', '%' || t_old || '%', t, t
      );
    END IF;

    -- ค้นหารุ่น
    IF is_num THEN
      sql_where := sql_where || format(' OR generation = %L)', t);
    ELSE
      sql_where := sql_where || ')';
    END IF;

    -- [SCORING SYSTEM]: ระบบให้คะแนนหลายระดับชั้น (ลอกแบบมาจาก Facebook/LinkedIn)
    sql_score := sql_score || format(
      ' + CASE WHEN generation::text = %L THEN 1000 ELSE 0 END'
      || ' + CASE '
      || '   WHEN first_name = %L THEN 1000 '                  -- Exact Match (First Name)
      || '   WHEN last_name = %L THEN 900 '                   -- Exact Match (Last Name)
      || '   WHEN first_name ILIKE %L THEN 600 '              -- Prefix Match (First Name)
      || '   WHEN last_name ILIKE %L THEN 500 '               -- Prefix Match (Last Name)
      || '   WHEN first_name ILIKE %L THEN 400 '              -- Contains Match (First Name)
      || '   WHEN last_name ILIKE %L THEN 350 '               -- Contains Match (Last Name)
      || '   WHEN norm_first = %L OR norm_first = %L THEN 300 ' -- Normalized Exact Match
      || '   WHEN norm_last = %L OR norm_last = %L THEN 250 '   -- Normalized Exact Match
      || '   WHEN norm_first ILIKE %L OR norm_first ILIKE %L THEN 150 ' -- Normalized Prefix Match
      || '   WHEN norm_last ILIKE %L OR norm_last ILIKE %L THEN 100 '   -- Normalized Prefix Match
      || '   WHEN first_name %% %L OR last_name %% %L THEN 50 ' -- Trigram / Fuzzy Match
      || '   ELSE 0 END',
      t,  -- generation
      t, t, -- Exact
      t || '%', t || '%', -- Prefix
      '%' || t || '%', '%' || t || '%', -- Contains
      nt, t_old, -- Norm Exact
      nt, t_old, -- Norm Exact
      nt || '%', t_old || '%', -- Norm Prefix
      nt || '%', t_old || '%', -- Norm Prefix
      t, t -- Fuzzy
    );
  END LOOP;

  -- [EXECUTE]: สั่งรันคำค้นหาและดึงตัวท็อป 300 คนที่คะแนนสูงสุด
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
