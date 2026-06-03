// Simple In-Memory LRU Cache สำหรับผลการค้นหา
// Cache อยู่ใน memory ของ Vercel Function instance
// TTL = 60 วินาที, max 50 entries
const CACHE_TTL_MS = 60_000;
const MAX_ENTRIES  = 50;

const cache = new Map(); // key → { data, expiry }

export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function cacheSet(key, data) {
  // ถ้าเกิน max entries ลบตัวเก่าสุดออก
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}
