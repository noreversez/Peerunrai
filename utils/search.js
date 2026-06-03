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
  // ตัดยศต่างๆ ออกก่อน เพื่อให้เหลือแค่ชื่อ
  const rankRegex = /^(พล\.ต\.อ\.|พล\.ต\.ท\.|พล\.ต\.ต\.|พ\.ต\.อ\.|พ\.ต\.ท\.|พ\.ต\.ต\.|ร\.ต\.อ\.|ร\.ต\.ท\.|ร\.ต\.ต\.|ด\.ต\.|จ\.ส\.ต\.|ส\.ต\.อ\.|ส\.ต\.ท\.|ส\.ต\.ต\.|ว่าที่|นาย|นาง|นางสาว|ผู้กอง|หมวด|สารวัตร|จ่า|หมู่|นต\.)(หญิง)?\s*/g;
  const cleanKeyword = keyword.replace(rankRegex, "").trim();
  
  // แยกคำค้นหาด้วยช่องว่าง (เช่น "สมชาย ใจดี" จะกลายเป็น ["สมชาย", "ใจดี"])
  const tokens = cleanKeyword.split(/\s+/).filter(t => t);
  if (tokens.length === 0) return { results: [], total: 0 };
  
  // สร้าง Query ของ Supabase
  let query = supabase.from('users').select('*');
  
  // วนลูปสร้างเงื่อนไขสำหรับแต่ละคำ (ต้องเจอครบทุกคำ ถึงจะดึงมา)
  tokens.forEach(t => {
    const normT = normIndex(t);
    const orCond = `norm_first.ilike.%${normT}%,norm_last.ilike.%${normT}%,generation.eq.${t},first_name.ilike.%${t}%,last_name.ilike.%${t}%`;
    query = query.or(orCond);
  });
  
  // ดึงข้อมูล 300 คนแรกที่ตรงเงื่อนไข (Exact/ILike)
  let { data: candidates, error } = await query.limit(300);
    
  if (error) {
    console.error("Supabase Search Error:", error);
    return { results: [], total: 0 };
  }
  
  // ก๊อก 2: หากไม่พบข้อมูล (พบน้อยกว่า 3 คน) ให้สลับไปใช้ Fuzzy Search (ค้นหาคำคล้าย)
  if (!candidates || candidates.length < 3) {
    const { data: fuzzyCandidates, error: fuzzyError } = await supabase.rpc('search_users_fuzzy', { search_tokens: tokens });
    if (!fuzzyError && fuzzyCandidates && fuzzyCandidates.length > 0) {
      // เอาผลลัพธ์จาก Fuzzy Search มาใช้แทน
      candidates = fuzzyCandidates;
    }
  }
  
  // ให้คะแนนความแม่นยำ (Relevance Scoring)
  let scoredUsers = candidates.map(u => {
    let score = 0;
    const uFirstNoSpace = (u.first_name || "").replace(/\s+/g, "");
    const uLastNoSpace = (u.last_name || "").replace(/\s+/g, "");
    const uGen = u.generation || "";

    // นำแต่ละคำค้นหามาให้คะแนน
    tokens.forEach(t => {
      if (uGen === t) score += 100; // หากตรงรุ่นพอดี ให้คะแนนเยอะมาก
      
      if (uFirstNoSpace.startsWith(t)) score += 80;
      else if (uFirstNoSpace.includes(t)) score += 40;
      
      if (uLastNoSpace.startsWith(t)) score += 60;
      else if (uLastNoSpace.includes(t)) score += 30;
    });

    // โฟกัส นรต. รุ่น 40-79 เป็นพิเศษ
    const genNum = parseInt(uGen);
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
