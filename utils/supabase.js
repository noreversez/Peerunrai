import { createClient } from '@supabase/supabase-js';

// Use environment variables provided by Vercel
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Missing Supabase URL or Key in environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
