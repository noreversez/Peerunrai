import { supabase } from './utils/supabase.js';

async function test() {
  console.log("Searching for เกปัน...");
  const { data, error } = await supabase
    .from('users')
    .select('first_name, last_name, generation, norm_first, norm_last')
    .or("first_name.ilike.%เกปัน%,last_name.ilike.%เกปัน%,norm_first.ilike.%กพน%,norm_last.ilike.%กพน%");

  if (error) console.error(error);
  else console.log(data);
}

test();
