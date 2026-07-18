// =============================================
// Rate limiter แบบ sliding-window เก็บใน memory ของ Vercel instance
// หมายเหตุ: Vercel มีหลาย instance — ตัวนี้จึงเป็นการกันแบบ best-effort
// (ชะลอ scraper/brute-force จากแหล่งเดียวได้จริง แต่ไม่ใช่ลิมิตแบบกระจายศูนย์)
// ถ้าต้องการลิมิตที่เป๊ะข้ามทุก instance ต้องใช้ Redis/Upstash หรือ Vercel WAF
// =============================================
const buckets = new Map(); // key → number[] (timestamps)

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);

  // เก็บกวาดกันหน่วยความจำบวม
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      const kept = v.filter(t => now - t < windowMs);
      if (kept.length === 0) buckets.delete(k);
      else buckets.set(k, kept);
    }
  }

  const count = arr.length;
  return {
    ok:         count <= max,
    remaining:  Math.max(0, max - count),
    retryAfter: Math.ceil(windowMs / 1000), // วินาที
  };
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
