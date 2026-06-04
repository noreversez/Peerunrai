import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // รับเฉพาะ POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, name, detail, contact } = req.body;

    // Validate
    if (!type || !detail || detail.trim().length < 5) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วนครับ' });
    }

    // บันทึกลง Supabase
    const { error } = await supabase
      .from('reports')
      .insert([{
        type:    type.trim(),
        name:    name?.trim()    || null,
        detail:  detail.trim(),
        contact: contact?.trim() || null,
        status:  'pending'
      }]);

    if (error) {
      console.error('report insert error:', error);
      return res.status(500).json({ error: 'ไม่สามารถบันทึกข้อมูลได้' });
    }

    return res.status(200).json({ ok: true, message: 'ส่งข้อมูลเรียบร้อยแล้วครับ' });

  } catch (err) {
    console.error('report handler error:', err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
  }
}
