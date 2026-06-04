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
// directSearch: Fallback กรณีที่ RPC ยังไม่ได้สร้าง
// ค้นหาผ่าน norm_first/norm_last ซึ่งมี Index
// =============================================
async function directSearch(rawTokens) {
  let query = supabase.from('users').select('*');
  rawTokens.forEach(t => {
    const nt    = normIndex(t);
    const tOld  = t.replace(/[่้๊๋็์ิีึืุูเแโใไัาอ]/g, '');
    const isNum = !isNaN(t) && t.trim() !== '';

    let conds;
    if (nt.length < 3) {
      conds = [
        `norm_first.ilike.${nt}%`,
        `norm_last.ilike.${nt}%`,
        `norm_first.ilike.${tOld}%`,
        `norm_last.ilike.${tOld}%`,
      ];
    } else {
      conds = [
        `norm_first.ilike.%${nt}%`,
        `norm_last.ilike.%${nt}%`,
        `norm_first.ilike.%${tOld}%`,
        `norm_last.ilike.%${tOld}%`,
      ];
    }
    if (isNum) conds.push(`generation.eq.${t}`);
    query = query.or(conds.join(','));
  });

  const { data, error } = await query.limit(300);
  if (error) {
    console.error('directSearch error:', error);
    return [];
  }

  // จัดลำดับด้วยคะแนนอย่างง่าย (ไม่ต้อง RPC)
  return (data || []).map(u => {
    let score = 0;
    const fn = (u.first_name || '');
    const ln = (u.last_name  || '');
    rawTokens.forEach(t => {
      if (fn === t || ln === t) score += 1000;
      else if (fn.startsWith(t) || ln.startsWith(t)) score += 600;
      else if (fn.includes(t) || ln.includes(t)) score += 300;
      else {
        const nt = normIndex(t);
        const nf = normIndex(fn);
        const nl = normIndex(ln);
        if (nf === nt || nl === nt) score += 200;
        else if (nf.includes(nt) || nl.includes(nt)) score += 100;
      }
    });
    return { ...u, score };
  }).sort((a, b) => b.score - a.score);
}

// =============================================
// searchUsers: ค้นหาหลัก
// ลอง RPC v4 ก่อน → fallback directSearch
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();
  if (!cleanKeyword) return { results: [], total: 0 };

  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  const cacheKey = `search_v4_${rawTokens.join('_')}_p${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let data = [];

  // ลอง RPC search_users_v4 (เร็วที่สุด + มี Fuzzy)
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v4', {
    raw_tokens: rawTokens
  });

  if (!rpcError && rpcData) {
    data = rpcData;
    console.log('RPC v4 hit:', rawTokens, 'results:', data.length);
  } else {
    // Fallback: ใช้ directSearch เมื่อ RPC ยังไม่ได้ Deploy
    console.warn('RPC v4 error, fallback to directSearch:', rpcError?.message);
    data = await directSearch(rawTokens);
    console.log('directSearch results:', data.length);
  }

  if (data.length === 0) return { results: [], total: 0 };

  const totalFound     = data.length;
  const startIndex     = (page - 1) * itemsPerPage;
  const limitedResults = data.slice(startIndex, startIndex + itemsPerPage);

  const result = { results: limitedResults, total: totalFound };
  cacheSet(cacheKey, result);
  return result;
}

// =============================================
// suggestUsers: ค้นหาชื่อใกล้เคียงเมื่อหาไม่เจอ
// =============================================
export async function suggestUsers(keyword) {
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();
  const rawTokens    = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return [];

  // ป้องกัน Timeout: คำสั้นกว่า 4 ตัวอักษร ข้ามการ suggest
  if (rawTokens.join('').length < 4) return [];

  // ลอง RPC v4 ก่อน
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v4', {
    raw_tokens: rawTokens
  });

  let pool = [];
  if (!rpcError && rpcData && rpcData.length > 0) {
    pool = rpcData;
  } else {
    pool = await directSearch(rawTokens);
  }

  if (pool.length === 0) return [];

  const seen = new Set();
  const result = [];
  for (const u of pool) {
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    if (fullName && !seen.has(fullName)) {
      seen.add(fullName);
      result.push(fullName);
      if (result.length >= 5) break;
    }
  }
  return result;
}
