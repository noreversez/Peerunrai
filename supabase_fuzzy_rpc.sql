-- สร้างฟังก์ชันการค้นหาแบบคล้ายคลึง (Fuzzy Search)
-- รองรับการรับค่าอาร์เรย์ของคำค้นหา (Tokens) เพื่อค้นหาหลายคำพร้อมกัน
CREATE OR REPLACE FUNCTION search_users_fuzzy(search_tokens text[])
RETURNS SETOF users
LANGUAGE sql
AS $$
  SELECT *
  FROM users
  WHERE (
    SELECT bool_and(
      generation = t
      OR norm_first % t
      OR norm_last % t
      OR first_name % t
      OR last_name % t
    )
    FROM unnest(search_tokens) AS t
  )
  LIMIT 300;
$$;
