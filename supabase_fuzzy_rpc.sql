-- สร้างฟังก์ชันการค้นหาแบบคล้ายคลึง (Fuzzy Search) แบบความเร็วสูง (ใช้ Index)
CREATE OR REPLACE FUNCTION search_users_fuzzy(search_tokens text[])
RETURNS SETOF users
LANGUAGE plpgsql
AS $$
DECLARE
  sql_query text;
  i int;
BEGIN
  -- สร้าง Dynamic SQL เพื่อบังคับให้ PostgreSQL เรียกใช้ GIN Index แทนการ Scan ทั้งตาราง
  sql_query := 'SELECT * FROM users WHERE 1=1';
  
  FOR i IN 1 .. array_length(search_tokens, 1) LOOP
    sql_query := sql_query || format(' AND (generation = %L OR norm_first %% %L OR norm_last %% %L)', search_tokens[i], search_tokens[i], search_tokens[i]);
  END LOOP;
  
  sql_query := sql_query || ' LIMIT 300';
  
  RETURN QUERY EXECUTE sql_query;
END;
$$;
