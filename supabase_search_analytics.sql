-- ============================================================
-- สถิติการค้นหาสำหรับหน้า Admin (RPC get_search_analytics)
-- รวมสรุป + คำยอดนิยม + "คำที่ค้นแล้วไม่พบ" + รายการล่าสุด ในครั้งเดียว
--
-- วิธีติดตั้ง: คัดลอกทั้งไฟล์ไปรันใน Supabase > SQL Editor (รันซ้ำได้)
-- ต้องมีตาราง search_logs อยู่ก่อน (supabase_search_logs.sql)
-- ============================================================

-- Index ช่วย query แบบกรองตามช่วงเวลา (เรียงใหม่สุดก่อน)
CREATE INDEX IF NOT EXISTS idx_search_logs_time
  ON public.search_logs (searched_at DESC);

CREATE OR REPLACE FUNCTION get_search_analytics(p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH recent AS (
    SELECT user_id, keyword, results_count, searched_at
    FROM public.search_logs
    WHERE searched_at >= now() - (p_days || ' days')::interval
      -- ตัด log การเปิดหน้าถัดไป ("... (หน้า N)") ออกจากสถิติคำค้น
      AND keyword NOT LIKE '% (หน้า %'
  ),
  summary AS (
    SELECT
      count(*)::int                                            AS total_searches,
      count(DISTINCT user_id)::int                             AS unique_users,
      count(*) FILTER (WHERE results_count = 0)::int           AS zero_results,
      count(*) FILTER (
        WHERE searched_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                            AT TIME ZONE 'Asia/Bangkok'
      )::int                                                   AS today_searches
    FROM recent
  ),
  top_kw AS (
    SELECT keyword, count(*)::int AS cnt, max(results_count)::int AS results
    FROM recent
    WHERE results_count > 0
    GROUP BY keyword
    ORDER BY cnt DESC, keyword
    LIMIT 25
  ),
  failed_kw AS (
    SELECT keyword,
           count(*)::int AS cnt,
           count(DISTINCT user_id)::int AS users,
           max(searched_at) AS last_at
    FROM recent
    WHERE results_count = 0
      AND length(regexp_replace(keyword, '\s', '', 'g')) >= 2
    GROUP BY keyword
    ORDER BY cnt DESC, last_at DESC
    LIMIT 40
  ),
  recent_list AS (
    SELECT keyword, results_count, searched_at, right(user_id, 4) AS uid_tail
    FROM recent
    ORDER BY searched_at DESC
    LIMIT 60
  )
  SELECT jsonb_build_object(
    'summary', COALESCE((SELECT row_to_json(s) FROM summary s), '{}'::json),
    'top',     COALESCE((SELECT jsonb_agg(t) FROM top_kw t),     '[]'::jsonb),
    'failed',  COALESCE((SELECT jsonb_agg(f) FROM failed_kw f),  '[]'::jsonb),
    'recent',  COALESCE((SELECT jsonb_agg(r) FROM recent_list r),'[]'::jsonb)
  );
$$;

-- ทดสอบ: SELECT get_search_analytics(7);
