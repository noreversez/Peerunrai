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

    const fn      = (u.first_name || '').trim();
    const ln      = (u.last_name  || '').trim();
    const fnClean = fn.replace(/\s+/g, '');
    const lnClean = ln.replace(/\s+/g, '');
    const gen     = String(u.generation || '');

    // ── 1. นับจำนวน token ที่ตรงกับชื่อต้นฉบับ (Exact Match) ──
    let exactCount = 0;
    tokens.forEach(t => {
      if (fn.includes(t) || ln.includes(t) || gen === t) exactCount++;
    });

    // ── 2. ตรวจสอบด้วยเสียง (Phonetic) - ใช้ startsWith ลดขยะ ──
    // ต้องมีพยัญชนะเหลือ >= 3 ตัวหลังตัดสระ ป้องกันค้นกว้างเกิน
    let phoneticCount = 0;
    if (exactCount === 0) {
      tokens.forEach(t => {
        const tNorm = normIndex(t);
        if (tNorm.length >= 3 &&
            (normIndex(fn).startsWith(tNorm) || normIndex(ln).startsWith(tNorm))) {
          phoneticCount++;
        }
      });
    }

    const totalMatch = exactCount + phoneticCount;
    if (totalMatch === 0) return null; // ไม่ตรงเลยสักนิดเดียว → ตัดออก

    // ── 3. คะแนนหลัก: ขึ้นกับสัดส่วนที่ตรง ──
    const total = tokens.length;
    if (exactCount === total) {
      score += 10000;              // ตรงทุก token → อันดับสูงสุด
    } else if (exactCount > 0) {
      score += exactCount * 1000;  // ตรงบางส่วน
    } else {
      score += phoneticCount * 50; // phonetic fallback
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

    return { ...u, score };
  }).filter(u => u !== null)
    .sort((a, b) => b.score - a.score);

  return scored;
}

// =============================================
// directSearch: ค้นหาตรงจาก DB
//
// รอบ 1A (AND):  ทุก token ต้องตรง (ระบบเดิม - แม่นยำที่สุด)
// รอบ 1B (OR):   Best Match - เฟ้นเมื่อหาไม่เจอใน AND (เฉพาะเมื่อค้นหลายคำ)
// รอบ 2   (norm): Phonetic fallback - เฟ้นเมื่อหาไม่เจอเลย
// =============================================
async function directSearch(rawTokens) {

  // ── รอบ 1A: AND Search (ระบบเดิม - ทุก token ต้องตรง) ──
  {
    let query = supabase.from('users').select('*');
    rawTokens.forEach(t => {
      const isNumber = !isNaN(t) && t.trim() !== '';
      if (isNumber) {
        query = query.or(`generation.eq.${t}`);
      } else {
        query = query.or(`first_name.ilike.%${t}%, last_name.ilike.%${t}%`);
      }
    });

    const { data, error } = await query.limit(150);
    if (!error && data && data.length > 0) {
      const scored = buildScores(data, rawTokens);
      if (scored.length > 0) {
        console.log('directSearch 1A (AND):', rawTokens.join(','), '→', scored.length);
        return scored;
      }
    }
    if (error) console.warn('directSearch 1A error:', error.message);
  }

  // ── รอบ 1B: OR Best Match (เฟ้นเมื่อ AND ไม่เจอ - เฉพาะเมื่อค้นหลายคำ) ──
  if (rawTokens.length > 1) {
    let query = supabase.from('users').select('*');
    const allConds = [];
    rawTokens.forEach(t => {
      const isNumber = !isNaN(t) && t.trim() !== '';
      if (isNumber) {
        allConds.push(`generation.eq.${t}`);
      } else {
        allConds.push(`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`);
      }
    });
    if (allConds.length > 0) {
      query = query.or(allConds.join(','));
      const { data, error } = await query.limit(150);
      if (!error && data && data.length > 0) {
        const scored = buildScores(data, rawTokens);
        if (scored.length > 0) {
          console.log('directSearch 1B (OR best-match):', rawTokens.join(','), '→', scored.length);
          return scored;
        }
      }
    }
  }

  // ── รอบ 2: Fallback ค้นหาด้วย norm (เมื่อไม่เจอในรอบ 1A/1B) ──
  {
    let query = supabase.from('users').select('*');
    const allConds = [];
    rawTokens.forEach(t => {
      const nt   = normIndex(t);
      const tOld = t.replace(/[ิีึืุูเแโใไัาอ่้๊๋็์]/g, '');
      // ข้ามถ้าพยัญชนะที่เหลือสั้นกว่า 3 ตัว (ป้องกันค้นกว้างเกิน เช่น แวอาลี → วล)
      if (nt.length < 3 && tOld.length < 3) {
        console.log('Round2 skip (too short):', t, '→ norm:', nt);
        return;
      }
      if (nt.length >= 3)   allConds.push(`norm_first.ilike.${nt}%`, `norm_last.ilike.${nt}%`);
      if (tOld.length >= 3) allConds.push(`norm_first.ilike.${tOld}%`, `norm_last.ilike.${tOld}%`);
      if (!isNaN(t) && t.trim() !== '') allConds.push(`generation.eq.${t}`);
    });
    
    if (allConds.length === 0) return [];
    query = query.or(allConds.join(','));

    const { data, error } = await query.limit(150);
    if (error) {
      console.error('directSearch round2 error:', error.message);
      return [];
    }
    console.log('directSearch round2 (norm fallback):', rawTokens.join(','), '→', (data || []).length);
    return buildScores(data || [], rawTokens);
  }
}

// =============================================
// searchUsers: ค้นหาหลัก (directSearch 2 รอบ)
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();
  if (!cleanKeyword) return { results: [], total: 0 };

  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  const cacheKey = `search_v5_${rawTokens.join('_')}_p${page}_n${itemsPerPage}`;
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

  // ใช้ directSearch ตรงๆ (แม่นยำกว่า RPC)
  const pool = await directSearch(rawTokens);

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
