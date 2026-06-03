-- สร้างฟังก์ชันลบสระและเปลี่ยนพยัญชนะให้ตรงกับโค้ด JavaScript
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
                      COALESCE(str, ''),
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

-- อัปเดตข้อมูลในตารางทั้งหมดให้ถูกต้องตามหลักการค้นหา
UPDATE public.users 
SET 
  norm_first = normalize_thai_name(first_name),
  norm_last = normalize_thai_name(last_name);
