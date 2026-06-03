import { supabase } from './supabase.js';

// =============================================
// logSearch: บันทึกประวัติการค้นหาแบบ async
// ไม่ block การตอบกลับ LINE เลย
// =============================================
export function logSearch(userId, keyword, resultsCount) {
  // fire-and-forget: ไม่ await เพื่อไม่ให้ช้า
  supabase.from('search_logs').insert({
    user_id:       userId,
    keyword:       keyword.substring(0, 200), // จำกัดความยาว
    results_count: resultsCount,
  }).then(({ error }) => {
    if (error) console.error('logSearch error:', error.message);
  });
}

// =============================================
// getRecentSearches: ดูประวัติ 5 อันล่าสุดของผู้ใช้
// =============================================
export async function getRecentSearches(userId) {
  const { data, error } = await supabase
    .from('search_logs')
    .select('keyword, results_count, searched_at')
    .eq('user_id', userId)
    .order('searched_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('getRecentSearches error:', error.message);
    return [];
  }
  return data || [];
}
