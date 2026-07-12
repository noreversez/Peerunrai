import { searchUsers } from '../utils/search.js';

export default async function handler(req, res) {
  // CORS สำหรับ frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, page = '1' } = req.query;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const { results, total, exact } = await searchUsers(q.trim(), pageNum, 20);

  return res.status(200).json({
    results: results.map(u => ({
      first_name: u.first_name || '',
      last_name:  u.last_name  || '',
      generation: u.generation || '',
      score:      u.score      || 0,
    })),
    total,
    exact:     exact !== false, // false = ผลใกล้เคียง (ไม่มีรายการที่ตรงครบทุกคำ)
    page:      pageNum,
    per_page:  20,
    keyword:   q.trim(),
  });
}
