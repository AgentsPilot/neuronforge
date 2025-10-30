// scripts/check-all-modes.ts
// Check active_mode for ALL rows to see if they're consistent

import { createClient } from '@supabase/supabase-js';

async function checkAllModes() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔍 Checking active_mode for all AIS ranges...\n');

  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('range_key, active_mode')
    .order('range_key', { ascending: true });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No ranges found');
    return;
  }

  console.log(`📊 Found ${data.length} ranges\n`);

  // Group by mode
  const modeGroups = data.reduce((acc, row) => {
    const mode = row.active_mode;
    if (!acc[mode]) acc[mode] = [];
    acc[mode].push(row.range_key);
    return acc;
  }, {} as Record<number, string[]>);

  // Display results
  Object.entries(modeGroups).forEach(([mode, keys]) => {
    const modeDesc = mode === '0' ? 'Best Practice' : mode === '1' ? 'Dynamic' : 'Unknown';
    console.log(`📊 Mode ${mode} (${modeDesc}): ${keys.length} ranges`);
    console.log(`   ${keys.join(', ')}`);
    console.log('');
  });

  // Check if consistent
  if (Object.keys(modeGroups).length === 1) {
    console.log('✅ All ranges have consistent active_mode');
  } else {
    console.log('⚠️ WARNING: Ranges have different active_mode values!');
  }
}

checkAllModes().catch(console.error);
