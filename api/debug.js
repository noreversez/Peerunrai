import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  try {
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact' })
      .limit(5);

    res.status(200).json({
      success: true,
      message: "ทดสอบการดึงข้อมูลจาก Supabase",
      total_users_found: count || (data ? data.length : 0),
      sample_data: data,
      error: error
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
