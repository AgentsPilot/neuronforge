import { createClient } from '@supabase/supabase-js';

async function checkAnalytics() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check all activity types
  const { data, error } = await supabase
    .from('token_usage')
    .select('activity_type, activity_name, model_name, cost_usd, input_tokens, output_tokens, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Recent AI Analytics:');
  console.log('='.repeat(100));

  const grouped = data?.reduce((acc: any, d) => {
    const key = `${d.activity_type}/${d.activity_name}`;
    if (!acc[key]) {
      acc[key] = { count: 0, totalCost: 0, models: new Set(), records: [] };
    }
    acc[key].count++;
    acc[key].totalCost += d.cost_usd || 0;
    acc[key].models.add(d.model_name);
    acc[key].records.push(d);
    return acc;
  }, {});

  for (const [key, stats] of Object.entries(grouped as any)) {
    console.log(`\n${key}:`);
    console.log(`  Count: ${stats.count}`);
    console.log(`  Total cost: $${stats.totalCost.toFixed(6)}`);
    console.log(`  Models: ${Array.from(stats.models).join(', ')}`);
    console.log(`  Latest: ${new Date(stats.records[0].created_at).toLocaleString()}`);
  }

  const totalCost = data?.reduce((sum, d) => sum + (d.cost_usd || 0), 0) || 0;
  const totalCalls = data?.length || 0;

  console.log('\n' + '='.repeat(100));
  console.log(`Total: ${totalCalls} calls, $${totalCost.toFixed(6)}`);
}

checkAnalytics().catch(console.error);
