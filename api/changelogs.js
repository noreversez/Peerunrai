import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('changelogs')
      .select('type, version_date, description')
      .eq('is_visible', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('changelog fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch changelogs' });
  }
}
