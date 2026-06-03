import { supabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// =============================================
// normIndex: ตัดสระ + รวมพยัญชนะเสียงเดียวกัน
// =============================================
export function normIndex(str) {
  if (!str) return '';
  const cleanStr = str.replace(/[่้๊๋็์ิีึืุูเแโใไัาอ]/g, '');
  return cleanStr
    .replace(/[ศษสซ]/g,      'ส')
    .replace(/[ณน]/g,         'น')
    .replace(/[ฬลร]/g,        'ล')
    .replace(/[ญย]/g,         'ย')
    .replace(/[ขฃคฅฆก]/g,    'ก')
    .replace(/[พผภปบ]/g,      'พ')
    .replace(/[ทธฐฒตถฎฏดฑ]/g, 'ต')
    .replace(/[ชฉฌจ]/g,      'จ');
}

// =============================================
// buildScores: ให้คะแนนความแม่นยำให้ชุดข้อมูล
// =============================================
function buildScores(data, tokens) {
  return (data || []).map(u => {
    let score = 0;
    const fn  = (u.norm_first || u.first_name || '').replace(/\s+/g, '');
    const ln  = (u.norm_last  || u.last_name  || '').replace(/\s+/g, '');
    const gen = u.generation || '';
    tokens.forEach(t => {
      const nt = normIndex(t);
      if (gen === t)              score += 200;
      if (fn === nt)              score += 300;
      else if (fn.startsWith(nt)) score += 150;
      else if (fn.includes(nt))   score +=  80;
      if (ln === nt)              score += 250;
      else if (ln.startsWith(nt)) score += 120;
      else if (ln.includes(nt))   score +=  60;
    });
    return { ...u, score };
  }).sort((a, b) => b.score - a.score);
}

// =============================================
// directSearch: fallback query เมื่อ RPC ไม่มี
// ใช้ PREFIX (ชื่อ%) สำหรับคำสั้น (< 3 ตัว)
// ใช้ CONTAINS (%ชื่อ%) สำหรับคำยาว (>= 3 ตัว)
// =============================================
async function directSearch(rawTokens) {
  let query = supabase.from('users').select('*');
  rawTokens.forEach(t => {
    const nt = normIndex(t);
    let orCond;
    if (nt.length < 3) {
      // คำสั้น: ใช้ PREFIX เท่านั้น → เร็วกว่า, ลดผลลัพธ์ที่ไม่เกี่ยวข้อง
      orCond = `norm_first.ilike.${nt}%,norm_last.ilike.${nt}%,generation.eq.${t}`;
    } else {
      // คำยาว: ใช้ CONTAINS → ครอบคลุมกว่า
      orCond = `norm_first.ilike.%${nt}%,norm_last.ilike.%${nt}%,generation.eq.${t}`;
    }
    query = query.or(orCond);
  });
  const { data, error } = await query.limit(300);
  if (error) {
    console.error('directSearch error:', error);
    return [];
  }
  return buildScores(data, rawTokens);
}

// =============================================
// searchUsers: ค้นหาหลัก (max 1-2 DB calls)
// Flow: Cache → RPC Exact → Direct Exact → Done
// ไม่มี Fuzzy ในนี้ → Fuzzy ทำที่ webhook แทน
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  // 1. ตัดยศตำรวจ/ทหารออก
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();

  // 2. แยก token
  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  const normTokens = rawTokens.map(t => normIndex(t));

  // ป้องกัน: ทุก token สั้น < 2 ตัวอักษร
  if (normTokens.every(t => t.length < 2)) {
    return { results: [], total: 0 };
  }

  // 3. ตรวจ Cache
  const cacheKey = `${normTokens.join('|')}:${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log('Cache hit:', cacheKey);
    return cached;
  }

  let data = null;

  // 4. ลอง RPC search_users_v2 ก่อน (1 DB call)
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v2', {
    search_tokens: normTokens,
    use_fuzzy:     false,
  });

  if (!rpcError && rpcData !== null) {
    data = rpcData;
  } else {
    // fallback: direct query (1 DB call)
    console.warn('search_users_v2 not found, using direct query');
    data = await directSearch(rawTokens);
  }

  // *** ไม่มี Fuzzy Fallback ในนี้อีกต่อไป ***
  // Fuzzy + "หรือคุณหมายถึง" จัดการที่ webhook.js แทน

  if (!data || data.length === 0) return { results: [], total: 0 };

  const totalFound     = data.length;
  const startIndex     = (page - 1) * itemsPerPage;
  const limitedResults = data.slice(startIndex, startIndex + itemsPerPage);

  const result = { results: limitedResults, total: totalFound };
  cacheSet(cacheKey, result);
  return result;
}

// =============================================
// suggestUsers: ค้นหา Fuzzy เพื่อแนะนำชื่อใกล้เคียง
// เรียกจาก webhook.js เฉพาะเมื่อ total === 0
// =============================================
export async function suggestUsers(keyword) {
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();
  const rawTokens    = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return [];

  const normTokens = rawTokens.map(t => normIndex(t));
  const totalChars = normTokens.join('').length;

  // คำสั้นเกินไปสำหรับ Fuzzy (pg_trgm ต้องการ >= 3 ตัวอักษร)
  if (totalChars < 3) return [];

  let suggestions = [];

  // ลอง RPC v2 fuzzy ก่อน
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v2', {
    search_tokens: normTokens,
    use_fuzzy:     true,
  });

  if (!rpcError && rpcData && rpcData.length > 0) {
    suggestions = rpcData;
  } else {
    // fallback: search_users_fuzzy
    const { data: fuzzyData, error: fuzzyErr } = await supabase.rpc('search_users_fuzzy', {
      search_tokens: rawTokens,
    });
    if (!fuzzyErr && fuzzyData) suggestions = fuzzyData;
  }

  if (suggestions.length === 0) return [];

  // คืนชื่อเต็มไม่ซ้ำ สูงสุด 5 รายการ
  const seen = new Set();
  const result = [];
  for (const u of suggestions) {
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    if (fullName && !seen.has(fullName)) {
      seen.add(fullName);
      result.push(fullName);
    }
    if (result.length >= 5) break;
  }
  return result;
}
