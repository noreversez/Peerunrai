import { supabase } from './supabase.js';

export function normIndex(str) {
  if (!str) return "";
  const cleanStr = str.replace(/[่้๊๋็์ิีึืุูเแโใไัาอ]/g, "");
  return cleanStr.replace(/[ศษสซ]/g, "ส")
            .replace(/[ณน]/g, "น")
            .replace(/[ฬลร]/g, "ล")
            .replace(/[ญย]/g, "ย")
            .replace(/[ขฃคฅฆก]/g, "ก")
            .replace(/[พผภปบ]/g, "พ")
            .replace(/[ทธฐฒตถฎฏดฑ]/g, "ต")
            .replace(/[ชฉฌจ]/g, "จ");
}

export async function searchUsers(keyword, page = 1, itemsPerPage = 30) {
  const cleanKey = keyword.replace(/\s+/g, "");
  const normKey = normIndex(cleanKey);
  
  // ดึงข้อมูล 300 คนแรกที่ตรงกับเงื่อนไขจาก Supabase (ใช้เวลาไม่กี่มิลลิวินาที)
  const { data: candidates, error } = await supabase
    .from('users')
    .select('*')
    .or(`norm_first.ilike.%${normKey}%,norm_last.ilike.%${normKey}%,generation.eq.${cleanKey},first_name.ilike.%${cleanKey}%,last_name.ilike.%${cleanKey}%`)
    .limit(300);
    
  if (error) {
    console.error("Supabase Search Error:", error);
    return { results: [], total: 0 };
  }
  
  // จัดอันดับผู้ใช้แบบเดียวกับ Google Apps Script เดิม (Relevance Scoring)
  let scoredUsers = candidates.map(u => {
    let score = 0;
    const uFirstNoSpace = u.first_name.replace(/\s+/g, "");
    const uLastNoSpace = u.last_name.replace(/\s+/g, "");

    // ให้คะแนนพิเศษสำหรับคนที่ตรงเป๊ะๆ ก่อน
    if (u.generation === cleanKey) score += 100;
    
    if (uFirstNoSpace.startsWith(cleanKey)) score += 80;
    else if (uFirstNoSpace.includes(cleanKey)) score += 40;
    
    if (uLastNoSpace.startsWith(cleanKey)) score += 60;
    else if (uLastNoSpace.includes(cleanKey)) score += 30;

    // โฟกัส นรต. รุ่น 40-79 เป็นพิเศษ
    const genNum = parseInt(u.generation);
    if (!isNaN(genNum) && genNum >= 40) {
      score += 15;
    }

    return { ...u, _score: score };
  });
  
  // เรียงลำดับตามคะแนน
  scoredUsers.sort((a, b) => b._score - a._score);
  
  const totalFound = scoredUsers.length;
  const startIndex = (page - 1) * itemsPerPage;
  const limitedResults = scoredUsers.slice(startIndex, startIndex + itemsPerPage);
  
  return { results: limitedResults, total: totalFound };
}
