import { searchUsers } from '../utils/search.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';
import { supabase } from '../utils/supabase.js';

// เพดานค้นหารายวันต่อ IP กัน scraping แบบยิงช้า ๆ เนียน ๆ ทั้งวัน
// (ต่างจาก rate limit ต่อนาทีด้านล่าง ตัวนี้นับสะสมผ่าน Supabase ให้แม่นยำข้าม
// serverless instance และอยู่รอดแม้ server รีสตาร์ท)
const DAILY_SEARCH_LIMIT = 400;

async function checkDailyQuota(ip) {
  try {
    const { data, error } = await supabase.rpc('increment_daily_search_count', { p_ip: ip });
    if (error) {
      // ยังไม่ได้รัน supabase_daily_search_quota.sql — ปล่อยผ่านไปก่อน ไม่ให้ค้นหาพัง
      console.warn('increment_daily_search_count RPC ล้มเหลว (ข้ามการเช็คโควตารายวัน):', error.message);
      return true;
    }
    return data <= DAILY_SEARCH_LIMIT;
  } catch (e) {
    console.warn('checkDailyQuota error (ข้ามการเช็ค):', e.message);
    return true;
  }
}

export default async function handler(req, res) {
  // CORS สำหรับ frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // กัน scraping / ยิงถล่ม: จำกัด 20 ครั้ง/นาที ต่อ IP
  const ip = getClientIp(req);
  const rl = rateLimit(`search:${ip}`, 20, 60_000);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }

  const { q, page = '1' } = req.query;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
  }
  // จำกัดความยาวคำค้น กัน payload ผิดปกติ
  if (q.length > 100) {
    return res.status(400).json({ error: 'คำค้นหายาวเกินไป' });
  }

  // กันดูดข้อมูลทั้งวัน: จำกัด 400 ครั้ง/วัน ต่อ IP (นับสะสมจริงใน DB)
  // เช็คทีหลังสุด (หลังผ่าน validation แล้ว) กันเปลืองโควตากับ request ที่ไม่ใช่การค้นหาจริง
  const underDailyQuota = await checkDailyQuota(ip);
  if (!underDailyQuota) {
    return res.status(429).json({ error: 'วันนี้ค้นหาครบโควตาแล้ว กรุณาลองใหม่พรุ่งนี้' });
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const { results, total, exact, generationOnly } = await searchUsers(q.trim(), pageNum, 20);

  return res.status(200).json({
    results: results.map(u => ({
      first_name: u.first_name || '',
      last_name:  u.last_name  || '',
      generation: u.generation || '',
      score:      u.score      || 0,
    })),
    total,
    exact:          exact !== false, // false = ผลใกล้เคียง (ไม่มีรายการที่ตรงครบทุกคำ)
    generationOnly: generationOnly === true, // true = ค้นด้วยเลขรุ่นล้วน ๆ ไม่แสดงรายชื่อ
    page:      pageNum,
    per_page:  20,
    keyword:   q.trim(),
  });
}
