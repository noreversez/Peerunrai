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
// searchUsers: ค้นหาหลักผ่าน Supabase RPC v4
// (รวม Exact, Partial, Fuzzy และ Ranking ไว้ใน DB แล้ว)
// =============================================
export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  // 1. ตัดยศตำรวจ/ทหารออก
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, '').trim();

  if (!cleanKeyword) return { results: [], total: 0 };

  // 2. แยกคำค้นหาตามช่องว่าง
  const rawTokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (rawTokens.length === 0) return { results: [], total: 0 };

  // 3. ตรวจสอบ Cache
  const cacheKey = `search_v4_${rawTokens.join('_')}_p${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log('Cache hit:', cacheKey);
    return cached;
  }

  // 4. เรียกใช้ RPC search_users_v4 ซึ่งจัดการทุกอย่างเรียบร้อยแล้ว
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v4', {
    raw_tokens: rawTokens
  });

  if (rpcError) {
    console.error('search_users_v4 error:', rpcError);
    return { results: [], total: 0 };
  }

  const data = rpcData || [];
  if (data.length === 0) return { results: [], total: 0 };

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

  const rawTotalChars = rawTokens.join('').length;

  // ป้องกัน DB Timeout: ถ้าคำค้นหาสั้นเกินไป (น้อยกว่า 4 ตัวอักษร) ให้ข้าม Fuzzy
  if (rawTotalChars < 4) return [];

  // ใช้งาน search_users_v4 สำหรับ Suggest Users ด้วย (ไม่ต้องมี search_users_v2 อีกต่อไป)
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_users_v4', {
    raw_tokens: rawTokens
  });

  if (rpcError || !rpcData || rpcData.length === 0) {
    return [];
  }

  // คืนชื่อเต็มไม่ซ้ำ สูงสุด 5 รายการ
  const seen = new Set();
  const result = [];
  for (const u of rpcData) {
    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
    if (fullName && !seen.has(fullName)) {
      seen.add(fullName);
      result.push(fullName);
      if (result.length >= 5) break;
    }
  }

  return result;
}
