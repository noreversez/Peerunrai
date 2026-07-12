-- ============================================================
-- ระบบค้นหา V5: ค้น + ให้คะแนน + เรียงลำดับ + นับจำนวนจริง ใน DB ครั้งเดียว
-- แก้ปัญหา: เพดาน 150 แถว, ลำดับสุ่ม, total ไม่ตรงจริง, ช้าเพราะยิงหลายรอบ
--
-- วิธีติดตั้ง: คัดลอก "ทั้งไฟล์" ไปรันใน Supabase > SQL Editor (รันซ้ำได้)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1) ฟังก์ชัน normalize (กฎเดียวกับ normIndex ใน JavaScript 100%)
--       เพิ่มการแก้ homoglyph ก่อน: เเ (สระเอ 2 ตัว) → แ, ํ+า → ำ
CREATE OR REPLACE FUNCTION normalize_thai_name(str text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      replace(replace(COALESCE(str, ''), 'เเ', 'แ'), 'ํา', 'ำ'),
                      '[่้๊๋็์ิีึืุูเแโใไัาอ]', '', 'g'
                    ),
                    '[ศษสซ]', 'ส', 'g'
                  ),
                  '[ณน]', 'น', 'g'
                ),
                '[ฬลร]', 'ล', 'g'
              ),
              '[ญย]', 'ย', 'g'
            ),
            '[ขฃคฅฆก]', 'ก', 'g'
          ),
          '[พผภปบ]', 'พ', 'g'
        ),
        '[ทธฐฒตถฎฏดฑ]', 'ต', 'g'
      ),
      '[ชฉฌจ]', 'จ', 'g'
    );
$$;

-- ── 2) ล้างข้อมูลเดิมที่สะกดด้วย homoglyph (เช่น "เเวอาลี" → "แวอาลี")
UPDATE public.users SET
  first_name = replace(replace(first_name, 'เเ', 'แ'), 'ํา', 'ำ'),
  last_name  = replace(replace(last_name,  'เเ', 'แ'), 'ํา', 'ำ')
WHERE first_name LIKE '%เเ%' OR last_name LIKE '%เเ%'
   OR first_name LIKE '%ํา%' OR last_name LIKE '%ํา%';

-- ── 3) คำนวณคอลัมน์ norm ใหม่ทั้งตารางด้วยกฎล่าสุด
UPDATE public.users SET
  norm_first = normalize_thai_name(first_name),
  norm_last  = normalize_thai_name(last_name);

-- ── 4) Indexes (สร้างเฉพาะที่ยังไม่มี)
CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm ON public.users USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm  ON public.users USING gin (last_name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_first_trgm ON public.users USING gin (norm_first gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last_trgm  ON public.users USING gin (norm_last  gin_trgm_ops);
-- B-tree สำหรับ LIKE 'คำ%' (prefix) — คอลัมน์เป็น text ต้องใช้ text_pattern_ops
CREATE INDEX IF NOT EXISTS idx_users_norm_first_prefix2 ON public.users (norm_first text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_norm_last_prefix2  ON public.users (norm_last  text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_generation ON public.users (generation);

-- ── 5) ฟังก์ชันค้นหาหลัก search_users_v5
--   ลำดับคะแนน:
--     100000+ = ตรงครบทุกคำ (is_exact = true; ถ้ามีกลุ่มนี้จะคืนเฉพาะกลุ่มนี้)
--     1000/คำ = ชื่อ-นามสกุลตรงบางคำ (+โบนัสรุ่นใกล้เคียงเมื่อค้น "ชื่อ รุ่น")
--     300/คำ  = ตรงเฉพาะเลขรุ่น
--     50/คำ   = ตรงเฉพาะเสียง (phonetic) + โบนัส trigram similarity ให้ตัวที่เขียนใกล้สุดขึ้นก่อน
--   total_count = จำนวนผลทั้งหมดจริง (ไม่มีเพดาน 150 อีกต่อไป)
CREATE OR REPLACE FUNCTION search_users_v5(
  raw_tokens text[],
  p_limit    int DEFAULT 20,
  p_offset   int DEFAULT 0
)
RETURNS TABLE (
  first_name  text,
  last_name   text,
  generation  text,
  score       real,
  is_exact    boolean,
  total_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  t           text;
  t_old       text;
  nt          text;
  n_tokens    int  := 0;
  target_gen  int  := NULL;
  kw_ns       text := '';
  kw_len      int;
  where_parts text[] := ARRAY[]::text[];
  exact_expr  text := '0';  -- จำนวน token ที่ตรงตัวจริง (ชื่อหรือรุ่น)
  name_expr   text := '0';  -- จำนวน token ที่ตรงชื่อ/นามสกุล
  gen_expr    text := '0';  -- จำนวน token ที่ตรงเลขรุ่น
  phon_expr   text := '0';  -- จำนวน token ที่ตรงเฉพาะเสียง
  sim_parts   text[] := ARRAY[]::text[];
  sim_expr    text := '0';
  prox_expr   text := '0';
  name_cond   text;
  phon_cond   text;
  pp          text[];
  bonus_expr  text;
  score_expr  text;
BEGIN
  IF raw_tokens IS NULL OR array_length(raw_tokens, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY raw_tokens LOOP
    t := trim(t);
    CONTINUE WHEN t = '';
    n_tokens := n_tokens + 1;
    IF n_tokens > 6 THEN
      n_tokens := 6;
      EXIT;
    END IF;
    kw_ns := kw_ns || t;

    -- token ที่เป็นตัวเลข = เลขรุ่น
    IF t ~ '^[0-9]+$' THEN
      target_gen  := t::int;
      where_parts := where_parts || format('u.generation = %L', t);
      exact_expr  := exact_expr || format(' + CASE WHEN u.generation = %L THEN 1 ELSE 0 END', t);
      gen_expr    := gen_expr   || format(' + CASE WHEN u.generation = %L THEN 1 ELSE 0 END', t);
      CONTINUE;
    END IF;

    t_old := regexp_replace(t, '[่้๊๋็์ิีึืุูเแโใไัาอ]', '', 'g');
    nt    := normalize_thai_name(t);

    -- ตรงตัวจริงกับชื่อ/นามสกุล
    name_cond   := format('(u.first_name ILIKE %L OR u.last_name ILIKE %L)',
                          '%' || t || '%', '%' || t || '%');
    where_parts := where_parts || name_cond;
    exact_expr  := exact_expr || ' + CASE WHEN ' || name_cond || ' THEN 1 ELSE 0 END';
    name_expr   := name_expr  || ' + CASE WHEN ' || name_cond || ' THEN 1 ELSE 0 END';

    -- ตรงด้วยเสียง (phonetic): คำสั้น (<3) ต้องตรงเป๊ะ / คำยาวใช้ prefix
    phon_cond := NULL;
    pp := ARRAY[]::text[];
    IF length(nt) < 3 AND length(t_old) < 3 THEN
      IF nt <> '' THEN
        pp := pp || format('u.norm_first = %L OR u.norm_last = %L', nt, nt);
      END IF;
      IF t_old <> '' AND t_old <> nt THEN
        pp := pp || format('u.norm_first = %L OR u.norm_last = %L', t_old, t_old);
      END IF;
    ELSE
      IF length(nt) >= 3 THEN
        pp := pp || format('u.norm_first LIKE %L OR u.norm_last LIKE %L', nt || '%', nt || '%');
      END IF;
      IF length(t_old) >= 3 AND t_old <> nt THEN
        pp := pp || format('u.norm_first LIKE %L OR u.norm_last LIKE %L', t_old || '%', t_old || '%');
      END IF;
    END IF;
    IF array_length(pp, 1) IS NOT NULL THEN
      phon_cond   := '(' || array_to_string(pp, ' OR ') || ')';
      where_parts := where_parts || phon_cond;
      phon_expr   := phon_expr || ' + CASE WHEN NOT ' || name_cond
                     || ' AND ' || phon_cond || ' THEN 1 ELSE 0 END';
      sim_parts   := sim_parts || format(
        'GREATEST(similarity(u.first_name, %L), similarity(u.last_name, %L))', t, t);
    END IF;
  END LOOP;

  IF n_tokens = 0 OR array_length(where_parts, 1) IS NULL THEN
    RETURN;
  END IF;

  -- โบนัส similarity: ใช้แยกลำดับกลุ่ม phonetic (ตัวที่เขียนใกล้คำค้นสุดขึ้นก่อน)
  IF array_length(sim_parts, 1) IS NOT NULL THEN
    sim_expr := 'GREATEST(' || array_to_string(sim_parts, ', ') || ')';
  END IF;

  -- โบนัสรุ่นใกล้เคียง: ค้น "ชื่อ รุ่น" แล้วชื่อตรงแต่รุ่นไม่ตรง → รุ่นที่ใกล้กว่าขึ้นก่อน
  IF target_gen IS NOT NULL THEN
    prox_expr := format(
      'CASE WHEN (%s) > 0 AND u.generation ~ ''^[0-9]+$''
            THEN GREATEST(0, 300 - abs(u.generation::int - %s) * 10)
            ELSE 0 END',
      name_expr, target_gen
    );
  END IF;

  -- โบนัสชื่อเต็มตรงกับคำค้นทั้งก้อน (ชั้นละเอียดเดิมของระบบ JS)
  kw_len := length(kw_ns);
  bonus_expr := format(
    'CASE WHEN replace(u.first_name, '' '', '''') = %L OR replace(u.last_name, '' '', '''') = %L THEN 500
          WHEN replace(u.first_name, '' '', '''') LIKE %L THEN 200
          WHEN replace(u.last_name,  '' '', '''') LIKE %L THEN 180
          WHEN %s >= 2 AND replace(u.first_name, '' '', '''') LIKE %L THEN 100
          WHEN %s >= 2 AND replace(u.last_name,  '' '', '''') LIKE %L THEN 90
          ELSE 0 END',
    kw_ns, kw_ns,
    kw_ns || '%', kw_ns || '%',
    kw_len, '%' || kw_ns || '%',
    kw_len, '%' || kw_ns || '%'
  );

  score_expr := format(
    'CASE WHEN (%1$s) >= %2$s THEN 100000
          WHEN (%3$s) > 0 OR (%4$s) > 0 THEN (%3$s) * 1000 + (%4$s) * 300 + (%5$s) * 50
          ELSE (%5$s) * 50 + ((%6$s) * 100)::int
     END + (%7$s) + (%8$s)',
    exact_expr, n_tokens, name_expr, gen_expr, phon_expr, sim_expr, bonus_expr, prox_expr
  );

  RETURN QUERY EXECUTE format(
    'WITH scored AS (
       SELECT u.first_name, u.last_name, u.generation,
              (%s)::real AS score,
              ((%s) >= %s) AS is_exact
       FROM public.users u
       WHERE %s
     ),
     f AS (SELECT COALESCE(bool_or(s.is_exact), false) AS has_exact FROM scored s)
     SELECT s.first_name, s.last_name, s.generation, s.score, s.is_exact,
            count(*) OVER() AS total_count
     FROM scored s, f
     WHERE s.is_exact OR NOT f.has_exact
     ORDER BY s.score DESC, s.first_name ASC, s.last_name ASC
     LIMIT %s OFFSET %s',
    score_expr, exact_expr, n_tokens,
    array_to_string(where_parts, ' OR '),
    p_limit, p_offset
  );
END;
$$;

-- ── 6) ทดสอบหลังติดตั้ง (ดูผลได้เลยใน SQL Editor)
-- SELECT * FROM search_users_v5(ARRAY['สมชาย'], 5, 0);
-- SELECT * FROM search_users_v5(ARRAY['สมชาย','79'], 5, 0);
-- SELECT * FROM search_users_v5(ARRAY['แวอาลี'], 5, 0);
-- SELECT * FROM search_users_v5(ARRAY['79'], 5, 0);
