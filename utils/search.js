import { supabase } from './supabase.js';

// =============================================
// normIndex: ตัดสระ + รวมพยัญชนะเสียงเดียวกัน
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
// directSearch: ค้นหาตรงๆ ผ่าน Supabase query
// ใช้เป็น fallback เมื่อ RPC ยังไม่ถูกสร้าง
// =============================================
async function directSearch(tokens) {
  let query = supabase.from('users').select('*');
  tokens.forEach(t => {
    const normT = normIndex(t);
    const orCond = `norm_first.ilike.%${normT}%,norm_last.ilike.%${normT}%,generation.eq.${t}`;
    query = query.or(orCond);
  });
  const { data, error } = await query.limit(300);
  if (error) {
    console.error('directSearch error:', error);
    return [];
  }
  // เรียงลำดับที่ JS
  return (data || []).map(u => {
    let score = 0;
    const fn = (u.first_name || '').replace(/\s+/g, '');
    const ln = (u.last_name  || '').replace(/\s+/g, '');
    const gen = u.generation || '';
    tokens.forEach(t => {
      const nt = normIndex(t);
      if (gen === t)           score += 100;
      if (fn.startsWith(nt))   score += 80;
      else if (fn.includes(nt)) score += 40;
      if (ln.startsWith(nt))   score += 60;
      else if (ln.includes(nt)) score += 30;
    });
    return { ...u, score };
  }).sort((a, b) => b.score - a.score);
}

// =============================================
// searchUsers: ลอง RPC v2 ก่อน → fallback direct
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  // 1. ตัดยศตำรวจ/ทหารออก
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();

  // 2. แยกคำ (token)
  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  // ป้องกันคำสั้นเกินไป (< 2 ตัวอักษร ทุก token)
  const normTokens = rawTokens.map(t => normIndex(t));
  if (normTokens.every(t => t.length < 2)) {
    return { results: [], total: 0 };
  }

  let data = null;

  // 3. ลองใช้ RPC search_users_v2 (เร็วที่สุด)
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v2', {
    search_tokens: normTokens,
    use_fuzzy:     false,
  });

  if (!rpcError && rpcData !== null) {
    // RPC ทำงานได้ → ใช้ผลจาก RPC
    data = rpcData;

    // Fuzzy Fallback ถ้าเจอน้อย
    const totalChars = normTokens.join('').length;
    if (data.length < 3 && totalChars >= 3) {
      const { data: fuzzyData, error: fuzzyErr } = await supabase.rpc('search_users_v2', {
        search_tokens: normTokens,
        use_fuzzy:     true,
      });
      if (!fuzzyErr && fuzzyData && fuzzyData.length > 0) {
        data = fuzzyData;
      }
    }
  } else {
    // RPC ยังไม่มี → ใช้การค้นหาตรงๆ แทน
    console.warn('search_users_v2 not found, falling back to direct query');
    data = await directSearch(rawTokens);

    // Fuzzy Fallback ด้วย search_users_fuzzy (ถ้ามี)
    const totalChars = normTokens.join('').length;
    if (data.length < 3 && totalChars >= 3) {
      const { data: fuzzyData, error: fuzzyErr } = await supabase.rpc('search_users_fuzzy', {
        search_tokens: rawTokens,
      });
      if (!fuzzyErr && fuzzyData && fuzzyData.length > 0) {
        data = fuzzyData.map(u => ({ ...u, score: 0 }));
      }
    }
  }

  if (!data || data.length === 0) return { results: [], total: 0 };

  const totalFound  = data.length;
  const startIndex  = (page - 1) * itemsPerPage;
  const limitedResults = data.slice(startIndex, startIndex + itemsPerPage);

  return { results: limitedResults, total: totalFound };
}
