// scripts/toggle-ais-mode.ts
// Toggle AIS mode between Best Practice (0) and Dynamic (1)

import { createClient } from '@supabase/supabase-js';

async function toggleAisMode(targetMode?: 0 | 1) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔧 AIS Mode Toggle Script\n');

  // Get current mode
  const { data: currentData, error: fetchError } = await supabase
    .from('ais_normalization_ranges')
    .select('active_mode')
    .limit(1)
    .single();

  if (fetchError) {
    console.error('❌ Error fetching current mode:', fetchError);
    return;
  }

  const currentMode = currentData?.active_mode || 0;
  console.log(`📊 Current Mode: ${currentMode} (${currentMode === 0 ? 'Best Practice' : 'Dynamic'})`);

  // Determine new mode
  const newMode = targetMode !== undefined ? targetMode : (currentMode === 0 ? 1 : 0);

  if (newMode === currentMode) {
    console.log(`✅ Already in ${newMode === 0 ? 'Best Practice' : 'Dynamic'} mode. No change needed.`);
    return;
  }

  console.log(`🔄 Switching to: ${newMode} (${newMode === 0 ? 'Best Practice' : 'Dynamic'})\n`);

  // Update all rows
  const { error: updateError } = await supabase
    .from('ais_normalization_ranges')
    .update({ active_mode: newMode })
    .neq('range_key', ''); // Update all rows

  if (updateError) {
    console.error('❌ Error updating mode:', updateError);
    return;
  }

  console.log('✅ Mode updated successfully!');

  // Verify the change
  const { data: verifyData, error: verifyError } = await supabase
    .from('ais_normalization_ranges')
    .select('range_key, active_mode')
    .limit(3);

  if (!verifyError && verifyData) {
    console.log('\n📊 Verification (first 3 rows):');
    verifyData.forEach(row => {
      console.log(`   ${row.range_key}: mode=${row.active_mode}`);
    });
  }

  console.log(`\n✅ All ranges now using: ${newMode === 0 ? 'Best Practice' : 'Dynamic (with fallback to Best Practice for invalid ranges)'}`);
}

// Get target mode from command line args
const args = process.argv.slice(2);
const targetMode = args[0] === '0' ? 0 : args[0] === '1' ? 1 : undefined;

if (args.length > 0 && targetMode === undefined) {
  console.log('Usage: npx tsx scripts/toggle-ais-mode.ts [0|1]');
  console.log('  0 = Best Practice mode');
  console.log('  1 = Dynamic mode');
  console.log('  (no argument = toggle current mode)');
  process.exit(1);
}

toggleAisMode(targetMode).catch(console.error);
