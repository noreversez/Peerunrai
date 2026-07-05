import { supabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// =============================================
// normIndex: ตัดสระ + รวมพยัญชนะเสียงเดียวกัน
// (ตรงกับระบบเก่า gs.txt 100%)
// =============================================
export function normIndex(str) {
  if (!str) return '';
  const cleanStr = str.replace(/[ิีึืุูเแโใไัาอ]/g, '')
                      .replace(/[่้๊๋็์]/g, '');
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
// buildScores: คิดคะแนนแบบเดียวกับระบบเก่า (gs.txt)
// ชั้น 1: ตรวจสอบกับชื่อ/นามสกุลต้นฉบับโดยตรง (สูงสุด)
// ชั้น 2: ตรวจสอบกับชื่อ normalized (fallback เสียง)
// =============================================
function buildScores(data, tokens) {
  const keywordNoSpace = tokens.join('');

  const scored = (data || []).map(u => {
    let score = 0;
    let isMatch = false;

    const fn      = (u.first_name || '').trim();
    const ln      = (u.last_name  || '').trim();
    const fnClean = fn.replace(/\s+/g, '');
    const lnClean = ln.replace(/\s+/g, '');
    const gen     = String(u.generation || '');

    // ── ชั้น 1: ตรวจสอบตรงๆ กับชื่อต้นฉบับ (เหมือนระบบเก่า) ──
    // ถ้าทุก token พบในชื่อจริง นามสกุลจริง หรือรุ่น → การันตี 100%
    const matchAllAnywhere = tokens.every(t => {
      const tNorm = normIndex(t);
      return fn.includes(t)               ||
             ln.includes(t)               ||
             gen === t                    ||
             normIndex(fn).includes(tNorm) ||
             normIndex(ln).includes(tNorm);
    });

    if (matchAllAnywhere) {
      isMatch = true;
      score += 1000; // บังคับแสดงผล การันตีตรงกับระบบเก่า
    }

    // ── ชั้น 2: คะแนนละเอียดแบบ Prefix / Contains ──
    if (fnClean === keywordNoSpace || lnClean === keywordNoSpace) {
      score += 500; // ตรงเป๊ะ 100%
    } else if (fnClean.startsWith(keywordNoSpace)) {
      score += 200;
    } else if (lnClean.startsWith(keywordNoSpace)) {
      score += 180;
    } else if (fnClean.includes(keywordNoSpace) && keywordNoSpace.length >= 2) {
      score += 100;
    } else if (lnClean.includes(keywordNoSpace) && keywordNoSpace.length >= 2) {
      score += 90;
    }

    // คะแนนรุ่น
    if (gen === keywordNoSpace) score += 300;

    if (!isMatch) return null; // ตัดคนที่ไม่เกี่ยวข้องออก
    return { ...u, score };
  }).filter(u => u !== null)
    .sort((a, b) => b.score - a.score);

  return scored;
}

// =============================================
// directSearch: ค้นหาตรงจาก DB แบบ 2 รอบ
//
// รอบ 1: ค้นหาในชื่อ/นามสกุล "ต้นฉบับ" ก่อน (แม่นที่สุด)
//         → ถ้าเจอ → หยุดทันที ไม่ต้องค้นต่อ
// รอบ 2: ถ้าไม่เจอเลย → fallback ค้นหาด้วย norm
//         (เผื่อผู้ใช้สะกดผิดหรือชื่อ normalized ไม่ตรง)
// =============================================
async function directSearch(rawTokens) {
  // ── รอบ 1: ค้นหาชื่อ/นามสกุลต้นฉบับ ──
  {
    let query = supabase.from('users').select('*');
    rawTokens.forEach(t => {
      const conds = [
        `first_name.ilike.%${t}%`,
        `last_name.ilike.%${t}%`
      ];
      if (!isNaN(t) && t.trim() !== '') conds.push(`generation.eq.${t}`);
      query = query.or(conds.join(','));
    });

    const { data, error } = await query.limit(150); // ลดจาก 300 เพื่อความเร็ว
    if (!error && data && data.length > 0) {
      console.log('directSearch round1 (raw):', rawTokens.join(','), '→', data.length);
      return buildScores(data, rawTokens);
    }
    if (error) console.warn('directSearch round1 error:', error.message);
  }

  // ── รอบ 2: Fallback ค้นหาด้วย norm (เมื่อไม่เจอในรอบ 1) ──
  {
    let query = supabase.from('users').select('*');
    rawTokens.forEach(t => {
      const nt   = normIndex(t);
      const tOld = t.replace(/[ิีึืุูเแโใไัาอ่้๊๋็์]/g, '');
      const conds = [
        `norm_first.ilike.%${nt}%`,
        `norm_last.ilike.%${nt}%`,
        `norm_first.ilike.%${tOld}%`,
        `norm_last.ilike.%${tOld}%`,
      ];
      if (!isNaN(t) && t.trim() !== '') conds.push(`generation.eq.${t}`);
      query = query.or(conds.join(','));
    });

    const { data, error } = await query.limit(150); // ลดจาก 300 เพื่อความเร็ว
    if (error) {
      console.error('directSearch round2 error:', error.message);
      return [];
    }
    console.log('directSearch round2 (norm fallback):', rawTokens.join(','), '→', (data || []).length);
    return buildScores(data || [], rawTokens);
  }
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

  let data = await directSearch(rawTokens);
  console.log('directSearch:', rawTokens.join(','), '→', data.length, 'results');

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

  // ป้องกัน Timeout: คำสั้นกว่า 3 ตัวอักษร ข้ามการ suggest
  if (rawTokens.join('').length < 3) return [];

  // ลอง RPC v4 ก่อน
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v4', {
    raw_tokens: rawTokens
  });

  let pool = [];
  if (!rpcError && rpcData && rpcData.length > 0) {
    pool = buildScores(rpcData, rawTokens);
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
