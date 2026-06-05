import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // เรียกใช้ RPC เพื่อ +1 ยอดวิวของวันนี้
    await supabase.rpc('increment_pageview');
  }

  try {
    // 1. ดึงยอดวิววันนี้
    // ใช้เวลาปัจจุบัน (ตามเซิร์ฟเวอร์ UTC, สามารถปรับ offset ได้ถ้าต้องการ แต่เพื่อความง่ายใช้ UTC)
    // สำหรับไทย +7 อาจจะไม่ตรง 100% แต่ใช้ได้ในระดับหนึ่ง หรือให้แน่ใจสามารถสร้าง date string ตาม timezone
    const now = new Date();
    // แปลงเป็นเวลาไทย
    const thaiDate = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const todayStr = thaiDate.toISOString().split('T')[0];
    
    const { data: todayData } = await supabase
      .from('pageviews')
      .select('views')
      .eq('date', todayStr)
      .maybeSingle();

    // 2. ดึงยอดรวมทั้งหมด
    const { data: allData } = await supabase
      .from('pageviews')
      .select('views');

    let total = 0;
    if (allData) {
      for (const row of allData) {
        total += row.views;
      }
    }

    const todayViews = todayData ? todayData.views : (req.method === 'POST' ? 1 : 0);

    return res.status(200).json({ today: todayViews, total });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
