import { supabase } from './supabase.js';

// =============================================
// normIndex: ตัดสระ + รวมพยัญชนะเสียงเดียวกัน
// ให้ตรงกับ normalize_thai_name() ใน Supabase
// =============================================
export function normIndex(str) {
  if (!str) return '';
  const cleanStr = str.replace(/[่้๊๋็์ิีึืุูเแโใไัาอ]/g, '');
  return cleanStr
    .replace(/[ศษสซ]/g,     'ส')
    .replace(/[ณน]/g,        'น')
    .replace(/[ฬลร]/g,       'ล')
    .replace(/[ญย]/g,        'ย')
    .replace(/[ขฃคฅฆก]/g,   'ก')
    .replace(/[พผภปบ]/g,     'พ')
    .replace(/[ทธฐฒตถฎฏดฑ]/g,'ต')
    .replace(/[ชฉฌจ]/g,     'จ');
}

// =============================================
// searchUsers: ค้นหาผ่าน RPC search_users_v2
// ใช้ DB scoring → ไม่ต้องดึงข้อมูลมาเรียงที่ JS
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  // 1. ตัดยศตำรวจ/ทหารออก
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();

  // 2. แยกคำ (token) แล้ว normalize แต่ละคำ
  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  // ส่ง normalized tokens ให้ RPC
  const tokens = rawTokens.map(t => normIndex(t));

  // 3. ป้องกันคำสั้นเกินไป (< 2 ตัวอักษร ทุก token)
  if (tokens.every(t => t.length < 2)) {
    return { results: [], total: 0 };
  }

  // 4. เรียก RPC ครั้งเดียว — Exact Search ก่อน
  let { data, error } = await supabase.rpc('search_users_v2', {
    search_tokens: tokens,
    use_fuzzy:     false,
  });

  if (error) {
    console.error('search_users_v2 error:', error);
    return { results: [], total: 0 };
  }

  // 5. Fuzzy Fallback: ถ้าเจอน้อยกว่า 3 คน และคำยาวพอ (>= 3 ตัวอักษร)
  const totalChars = tokens.join('').length;
  if ((!data || data.length < 3) && totalChars >= 3) {
    const { data: fuzzyData, error: fuzzyError } = await supabase.rpc('search_users_v2', {
      search_tokens: tokens,
      use_fuzzy:     true,
    });
    if (!fuzzyError && fuzzyData && fuzzyData.length > 0) {
      data = fuzzyData;
    }
  }

  if (!data || data.length === 0) return { results: [], total: 0 };

  // 6. Paginate (ข้อมูลถูก sort โดย DB แล้ว)
  const totalFound  = data.length;
  const startIndex  = (page - 1) * itemsPerPage;
  const limitedResults = data.slice(startIndex, startIndex + itemsPerPage);

  return { results: limitedResults, total: totalFound };
}
