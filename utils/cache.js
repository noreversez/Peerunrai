// Simple In-Memory LRU Cache สำหรับผลการค้นหา
// Cache อยู่ใน memory ของ Vercel Function instance
// TTL = 5 นาที (ข้อมูลรายชื่อแทบไม่เปลี่ยน), max 100 entries
const CACHE_TTL_MS = 300_000;
const MAX_ENTRIES  = 100;

const cache = new Map(); // key → { data, expiry }

export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  // LRU จริง: ย้าย entry ที่เพิ่งใช้ไปท้ายคิว จะได้ไม่โดนลบก่อน
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

export function cacheSet(key, data) {
  // ถ้าเกิน max entries ลบตัวที่ไม่ได้ใช้นานสุดออก
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}
