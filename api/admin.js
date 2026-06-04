import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'peerunrai-admin';

// ตรวจสอบรหัสผ่าน
function checkAuth(req) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  return pw === ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  const { action } = req.query;

  // ── Auth Check ──
  if (action === 'auth') {
    const pw = req.body?.password || req.query.pw;
    if (pw === ADMIN_PASSWORD) {
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'รหัสผ่านไม่ถูกต้อง' });
  }

  // ทุก action ที่เหลือต้องผ่านการ Auth ก่อน
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
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
