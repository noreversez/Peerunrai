import { supabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// =============================================
// normIndex: ตัดสระ + รวมพยัญชนะเสียงเดียวกัน
// (ตรงกับ normalize_thai_name ใน DB 100%)
// =============================================
export function normIndex(str) {
  if (!str) return '';
  const cleanStr = fixHomoglyphs(str)
    .replace(/[ิีึืุูเแโใไัาอ]/g, '')
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
// การเตรียมคำค้น: ตัดยศ + แก้ homoglyph + ตัดอักขระอันตราย
// =============================================
const RANK_REGEX = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;

// เเ (สระเอ 2 ตัว) → แ, ํ+า → ำ (พบจริงในข้อมูล เช่น "เเวอาลี")
export function fixHomoglyphs(str) {
  return String(str || '').replace(/เเ/g, 'แ').replace(/ํา/g, 'ำ');
}

function tokenize(keyword) {
  const clean = fixHomoglyphs(String(keyword || ''))
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(RANK_REGEX, '')                     // ตัดยศนำหน้า
    .replace(/[%_\\,()<>{}[\]"']/g, ' ')         // อักขระที่ทำ query พัง / wildcard
    .trim();
  return clean.split(/\s+/).filter(Boolean).slice(0, 5);
}

// =============================================
// searchUsers: ค้นหาหลัก — ใช้ RPC search_users_v5
// (ค้น + ให้คะแนน + เรียง + นับจำนวนจริง ใน DB ครั้งเดียว)
// คืน { results, total, exact } — exact = false คือผลใกล้เคียง
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  const rawTokens = tokenize(keyword);
  if (rawTokens.length === 0) return { results: [], total: 0, exact: true };

  const cacheKey = `search_v6_${rawTokens.join('|')}_p${page}_n${itemsPerPage}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let result;
  const { data, error } = await supabase.rpc('search_users_v5', {
    raw_tokens: rawTokens,
    p_limit:    itemsPerPage,
    p_offset:   (page - 1) * itemsPerPage,
  });

  if (!error && Array.isArray(data)) {
    result = {
      results: data.map(r => ({
        first_name: r.first_name || '',
        last_name:  r.last_name  || '',
        generation: r.generation || '',
        score:      Math.round(r.score || 0),
      })),
      total: data.length > 0 ? Number(data[0].total_count) : 0,
      exact: data.length > 0 ? data[0].is_exact === true : true,
    };
  } else {
    // fallback: ใช้เส้นทางเดิม (กรณี RPC ยังไม่ได้ติดตั้งใน Supabase)
    if (error) console.warn('search_users_v5 RPC ล้มเหลว → fallback directSearch:', error.message);
    const all   = await directSearch(rawTokens);
    const start = (page - 1) * itemsPerPage;
    result = {
      results: all.slice(start, start + itemsPerPage),
      total:   all.length,
      exact:   all.length > 0 ? all[0].score >= 10000 : true,
    };
  }

  cacheSet(cacheKey, result);
  return result;
}

// =============================================
// suggestUsers: ชื่อใกล้เคียงเมื่อหาไม่เจอ (ใช้ผลจาก searchUsers เดิม)
// =============================================
export async function suggestUsers(keyword) {
  const rawTokens = tokenize(keyword);
  if (rawTokens.length === 0) return [];
  if (rawTokens.join('').length < 3) return [];

  const { results } = await searchUsers(keyword, 1, 15);
  const seen = new Set();
  const out  = [];
  for (const u of results) {
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    if (fullName && !seen.has(fullName)) {
      seen.add(fullName);
      out.push(fullName);
      if (out.length >= 5) break;
    }
  }
  return out;
}

// =============================================
// ─── เส้นทางสำรอง (fallback) — โค้ดระบบเดิมทั้งชุด ───
// ใช้เฉพาะเมื่อ RPC search_users_v5 ยังไม่ถูกติดตั้ง
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

    let exactCount = 0;
    tokens.forEach(t => {
      if (fn.includes(t) || ln.includes(t) || gen === t) exactCount++;
    });

    let phoneticCount = 0;
    if (exactCount === 0) {
      tokens.forEach(t => {
        const tNorm = normIndex(t);
        if (!tNorm) return;
        if (tNorm.length < 3) {
          if (normIndex(fn) === tNorm || normIndex(ln) === tNorm) phoneticCount++;
        } else {
          if (normIndex(fn).startsWith(tNorm) || normIndex(ln).startsWith(tNorm)) phoneticCount++;
        }
      });
    }

    const totalMatch = exactCount + phoneticCount;
    if (totalMatch === 0) return null;

    const total = tokens.length;
    if (exactCount === total) {
      score += 10000;
    } else if (exactCount > 0) {
      score += exactCount * 1000;
    } else {
      score += phoneticCount * 50;
    }

    if (fnClean === keywordNoSpace || lnClean === keywordNoSpace) {
      score += 500;
    } else if (fnClean.startsWith(keywordNoSpace)) {
      score += 200;
    } else if (lnClean.startsWith(keywordNoSpace)) {
      score += 180;
    } else if (fnClean.includes(keywordNoSpace) && keywordNoSpace.length >= 2) {
      score += 100;
    } else if (lnClean.includes(keywordNoSpace) && keywordNoSpace.length >= 2) {
      score += 90;
    }

    if (gen === keywordNoSpace) score += 300;

    return { ...u, score };
  }).filter(u => u !== null)
    .sort((a, b) => b.score - a.score);

  return scored;
}

async function directSearch(rawTokens) {
  // ── รอบ 1A: AND Search (ทุก token ต้องตรง) ──
  {
    let query = supabase.from('users').select('*');
    rawTokens.forEach(t => {
      const isNumber = !isNaN(t) && t.trim() !== '';
      if (isNumber) {
        query = query.or(`generation.eq.${t}`);
      } else {
        query = query.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%`);
      }
    });

    const { data, error } = await query.limit(150);
    if (!error && data && data.length > 0) {
      const scored = buildScores(data, rawTokens);
      if (scored.length > 0) return scored;
    }
    if (error) console.warn('directSearch 1A error:', error.message);
  }

  // ── รอบ 1B: OR Best Match ──
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
        if (scored.length > 0) return scored;
      }
    }
  }

  // ── รอบ 2: Phonetic fallback ──
  {
    let query = supabase.from('users').select('*');
    const allConds = [];
    rawTokens.forEach(t => {
      const nt   = normIndex(t);
      const tOld = t.replace(/[ิีึืุูเแโใไัาอ่้๊๋็์]/g, '');
      if (nt.length < 3 && tOld.length < 3) {
        if (nt) allConds.push(`norm_first.eq.${nt}`, `norm_last.eq.${nt}`);
        if (tOld) allConds.push(`norm_first.eq.${tOld}`, `norm_last.eq.${tOld}`);
      } else {
        if (nt.length >= 3)   allConds.push(`norm_first.ilike.${nt}%`, `norm_last.ilike.${nt}%`);
        if (tOld.length >= 3) allConds.push(`norm_first.ilike.${tOld}%`, `norm_last.ilike.${tOld}%`);
      }
      if (!isNaN(t) && t.trim() !== '') allConds.push(`generation.eq.${t}`);
    });

    if (allConds.length === 0) return [];
    query = query.or(allConds.join(','));

    const { data, error } = await query.limit(150);
    if (error) {
      console.error('directSearch round2 error:', error.message);
      return [];
    }
    return buildScores(data || [], rawTokens);
  }
}
