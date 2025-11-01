// scripts/check-ais-ranges.ts
// Quick script to check AIS normalization ranges in database

import { createClient } from '@supabase/supabase-js';

async function checkAisRanges() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔍 Fetching AIS normalization ranges...\n');

  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('*')
    .order('category', { ascending: true });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No ranges found');
    return;
  }

  console.log(`✅ Found ${data.length} ranges\n`);
  console.log(`Active Mode: ${data[0]?.active_mode} (${data[0]?.active_mode === 0 ? 'Best Practice' : 'Dynamic'})\n`);

  // Group by category
  const categories = ['token_complexity', 'execution_complexity', 'plugin_complexity', 'workflow_complexity'];

  categories.forEach(category => {
    const categoryRanges = data.filter(r => r.category === category);
    if (categoryRanges.length > 0) {
      console.log(`\n📊 ${category.toUpperCase().replace(/_/g, ' ')}`);
      console.log('─'.repeat(80));

      categoryRanges.forEach(range => {
        console.log(`\n  ${range.range_key}:`);
        console.log(`    Best Practice: min=${range.best_practice_min}, max=${range.best_practice_max}`);
        console.log(`    Dynamic:       min=${range.dynamic_min === null ? 'NULL' : range.dynamic_min}, max=${range.dynamic_max === null ? 'NULL' : range.dynamic_max}`);
      });
    }
  });

  console.log('\n');
}

checkAisRanges().catch(console.error);
