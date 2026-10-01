
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.rpc('submit_report', {
    p_report_type_id: '12345678-1234-1234-1234-123456789012',
    p_title: 'Test',
    p_description: null
  });
  console.log('--- RPC RESULT ---');
  console.log(JSON.stringify({ data, error }, null, 2));
}
test();

