import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';
import { normIndex, fixHomoglyphs } from '../utils/search.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

// ไม่มีรหัสผ่านสำรอง (fail-closed): ถ้าไม่ตั้ง env ADMIN_PASSWORD ระบบ admin จะถูกปิดสนิท
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD ไม่ได้ตั้งค่า — ระบบ admin ถูกปิดใช้งานทั้งหมด');
}

// เปรียบเทียบแบบ constant-time กัน timing attack
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ตรวจสอบรหัสผ่าน (รับเฉพาะทาง header เท่านั้น ไม่รับผ่าน query string ที่ติดใน log)
function checkAuth(req) {
  if (!ADMIN_PASSWORD) return false;
  return safeEqual(req.headers['x-admin-password'], ADMIN_PASSWORD);
}

function checkAuthPassword(pw) {
  if (!ADMIN_PASSWORD) return false;
  return safeEqual(pw, ADMIN_PASSWORD);
}

export default async function handler(req, res) {
  const { action } = req.query;

  // ── Auth Check ──
  if (action === 'auth') {
    // จำกัดการลองรหัสผ่าน 10 ครั้ง/5 นาที ต่อ IP กัน brute-force
    const ip = getClientIp(req);
    const rl = rateLimit(`admin-auth:${ip}`, 10, 5 * 60_000);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfter));
      return res.status(429).json({ ok: false, error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' });
    }
    if (checkAuthPassword(req.body?.password)) {
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
  }

  // ทุก action ที่เหลือต้องผ่านการ Auth ก่อน
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET: สถิติการค้นหา (ยอดนิยม + คำที่ค้นไม่พบ + ล่าสุด) ──
  if (req.method === 'GET' && action === 'search-analytics') {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const { data, error } = await supabase.rpc('get_search_analytics', { p_days: days });
    if (error) {
      // RPC ยังไม่ถูกติดตั้ง → บอก frontend ให้ขึ้นคำแนะนำรัน SQL
      return res.status(500).json({ error: error.message, needsSql: true });
    }
    return res.status(200).json({ data });
  }

  // ══════════════════════════════════════════════════
  //  จัดการรายชื่อ นรต. (ตาราง users)
  // ══════════════════════════════════════════════════

  // ── GET: ค้นหา นรต. สำหรับหน้าจัดการ (ต่างจาก /api/search: ตรงไปตรงมา + เห็นที่เก็บถาวรได้) ──
  if (req.method === 'GET' && action === 'users-search') {
    const q = String(req.query.q || '').trim();
    const showArchived = req.query.archived === '1';
    let query = supabase
      .from('users')
      .select('id, first_name, last_name, generation, is_active, created_at')
      .order('generation', { ascending: true })
      .limit(100);
    if (!showArchived) query = query.eq('is_active', true);
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ').trim();
      const isNum = /^[0-9]+$/.test(safe);
      if (isNum) query = query.eq('generation', safe);
      else query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message, needsSql: /is_active/.test(error.message) });
    return res.status(200).json({ data });
  }

  // ── POST: เพิ่ม นรต. ใหม่ ──
  if (req.method === 'POST' && action === 'user-create') {
    const v = cleanUserInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { data, error } = await supabase.from('users').insert(v.row).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    await writeAudit(supabase, 'create', data.id, { after: v.row }, req);
    return res.status(200).json({ ok: true, id: data.id });
  }

  // ── PATCH: แก้ไข นรต. (คำนวณ norm ใหม่ให้อัตโนมัติ) ──
  if (req.method === 'PATCH' && action === 'user-update') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ไม่พบ id' });
    const v = cleanUserInput(req.body);
    if (v.error) return res.status(400).json({ error: v.error });

    const { data: before } = await supabase
      .from('users').select('first_name, last_name, generation').eq('id', id).single();

    const { error } = await supabase.from('users').update(v.row).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await writeAudit(supabase, 'update', id, { before, after: v.row }, req);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: เก็บถาวร / กู้คืน (soft delete) ──
  if (req.method === 'PATCH' && action === 'user-archive') {
    const { id, active } = req.body || {};
    if (!id || typeof active !== 'boolean') return res.status(400).json({ error: 'ต้องระบุ id และ active (true/false)' });
    const { error } = await supabase.from('users').update({ is_active: active }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message, needsSql: /is_active/.test(error.message) });
    await writeAudit(supabase, active ? 'restore' : 'archive', id, {}, req);
    return res.status(200).json({ ok: true });
  }

  // ── GET: หาชื่อซ้ำ (ชื่อ+สกุล+รุ่น ตรงกัน) ──
  if (req.method === 'GET' && action === 'users-duplicates') {
    const { data, error } = await supabase.rpc('find_duplicate_users');
    if (error) return res.status(500).json({ error: error.message, needsSql: true });
    return res.status(200).json({ data });
  }

  // ── GET: ประวัติการแก้ไขของ Admin (audit log) ──
  if (req.method === 'GET' && action === 'audit-log') {
    const { data, error } = await supabase
      .from('admin_audit')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message, needsSql: true });
    return res.status(200).json({ data });
  }

  // ── GET: ดึงสถิติผู้เข้าชม ──
  if (req.method === 'GET' && action === 'pageviews') {
    const { data, error } = await supabase
      .from('pageviews')
      .select('*')
      .order('date', { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  // ── GET: ดึงรายการแจ้งปัญหา ──
  if (req.method === 'GET' && action === 'reports') {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  // ── PATCH: อัปเดทสถานะรายการแจ้งปัญหา ──
  if (req.method === 'PATCH' && action === 'report-status') {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'Missing id or status' });
    const { error } = await supabase.from('reports').update({ status }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── GET: ดึง Changelog ──
  if (req.method === 'GET' && action === 'changelogs') {
    const { data, error } = await supabase
      .from('changelogs')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  // ── POST: เพิ่ม Changelog ──
  if (req.method === 'POST' && action === 'changelog-add') {
    const { type, version_date, description, sort_order } = req.body;
    if (!type || !version_date || !description) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const { error } = await supabase.from('changelogs').insert([{
      type, version_date, description,
      sort_order: sort_order ?? 0,
      is_visible: true
    }]);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: ลบ Changelog ──
  if (req.method === 'DELETE' && action === 'changelog-delete') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { error } = await supabase.from('changelogs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: แก้ไข Changelog ──
  if (req.method === 'PATCH' && action === 'changelog-edit') {
    const { id, type, version_date, description, sort_order, is_visible } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { error } = await supabase.from('changelogs')
      .update({ type, version_date, description, sort_order, is_visible })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ error: 'Unknown action' });
}

// ตรวจ + ทำความสะอาด input ของ นรต. แล้วคำนวณ norm ให้พร้อมบันทึก
function cleanUserInput(body) {
  const first = fixHomoglyphs(String(body?.first_name || '').trim().replace(/\s+/g, ' '));
  const last  = fixHomoglyphs(String(body?.last_name  || '').trim().replace(/\s+/g, ' '));
  const gen   = String(body?.generation || '').trim();

  if (!first)  return { error: 'กรุณากรอกชื่อ' };
  if (!last)   return { error: 'กรุณากรอกนามสกุล' };
  if (!gen)    return { error: 'กรุณากรอกรุ่น' };
  if (first.length > 100 || last.length > 100 || gen.length > 20) {
    return { error: 'ข้อมูลยาวเกินไป' };
  }

  return {
    row: {
      first_name: first,
      last_name:  last,
      generation: gen,
      norm_first: normIndex(first),
      norm_last:  normIndex(last),
    },
  };
}

// บันทึก audit log แบบ best-effort (ถ้าตาราง admin_audit ยังไม่มี จะไม่ทำให้งานหลักล้ม)
async function writeAudit(supabase, actionName, targetId, detail, req) {
  try {
    await supabase.from('admin_audit').insert({
      action:    actionName,
      target_id: targetId,
      detail:    detail || {},
      ip:        getClientIp(req),
    });
  } catch (e) {
    console.warn('writeAudit ล้มเหลว (ข้ามได้):', e?.message);
  }
}
