require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data } = await supabase
    .from('workflow_executions')
    .select('execution_results')
    .eq('id', '85e7e3ec-ae7e-4764-bd30-fbe18bfef292')
    .single();

  const items = data?.execution_results?.items || [];

  console.log(`\n📊 Execution Steps (${items.length} total):\n`);

  items.forEach(item => {
    console.log(`${item.stepId || item.step_id}: ${item.stepName || item.name || item.action}`);
    console.log(`  Status: ${item.status}`);
    console.log(`  Data type: ${item.dataType || 'N/A'}`);
    console.log(`  Item count: ${item.itemCount || item.count || 'N/A'}`);

    if (item.stepId?.includes('filter')) {
      console.log(`  🔍 FILTER STEP - Count: ${item.itemCount || 0}`);
      if (item.itemCount === 0) {
        console.log(`     ⚠️  EMPTY RESULT!`);
      }
    }

    if (item.stepId?.includes('map')) {
      console.log(`  📋 MAP STEP - Count: ${item.itemCount || 0}`);
    }

    if (item.action === 'append_values' || item.action === 'append_rows') {
      console.log(`  📤 DELIVERY STEP - Sent ${item.itemCount || 0} rows`);
    }

    console.log('');
  });

  // Find filters and check their outputs
  const filterSteps = items.filter(i => i.stepId?.includes('filter'));
  console.log(`\n🔍 Filter Analysis:`);
  console.log(`  Found ${filterSteps.length} filter steps`);
  filterSteps.forEach(f => {
    console.log(`  ${f.stepId}: ${f.itemCount || 0} items`);
  });

  // Find map steps
  const mapSteps = items.filter(i => i.stepId?.includes('map'));
  console.log(`\n📋 Map Analysis:`);
  console.log(`  Found ${mapSteps.length} map steps`);
  mapSteps.forEach(m => {
    console.log(`  ${m.stepId}: ${m.itemCount || 0} rows`);
  });

  // Find delivery steps
  const deliverySteps = items.filter(i => i.action === 'append_values' || i.action === 'append_rows');
  console.log(`\n📤 Delivery Analysis:`);
  console.log(`  Found ${deliverySteps.length} delivery steps`);
  deliverySteps.forEach(d => {
    console.log(`  ${d.stepId}: ${d.itemCount || 0} rows sent`);
  });
})();
