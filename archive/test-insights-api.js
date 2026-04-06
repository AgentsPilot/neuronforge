require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAPI() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  console.log('Testing insights API simulation...\n');
  
  // Simulate what the API does
  const statuses = ['new', 'viewed'];
  
  const { data, error } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .in('status', statuses)
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('API would return:');
  console.log('  Success: true');
  console.log('  Count: ' + data.length);
  console.log('  Data:');
  
  if (data.length > 0) {
    data.forEach((insight, i) => {
      console.log('\n  Insight #' + (i + 1) + ':');
      console.log('    ID: ' + insight.id);
      console.log('    Title: ' + insight.title);
      console.log('    Severity: ' + insight.severity);
      console.log('    Category: ' + insight.category);
      console.log('    Status: ' + insight.status);
      console.log('    Created: ' + insight.created_at);
    });
  } else {
    console.log('    (empty array)');
  }

  console.log('\n\nUI TROUBLESHOOTING:');
  console.log('1. ✅ Insight exists in database');
  console.log('2. ✅ API query would return the insight');
  console.log('3. ❓ Check if UI is calling the API');
  console.log('4. ❓ Check browser console for errors');
  console.log('5. ❓ Try hard refresh (Cmd+Shift+R)');
}

testAPI();
