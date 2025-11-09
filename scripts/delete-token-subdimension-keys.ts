// scripts/delete-token-subdimension-keys.ts
// Delete unused token subdimension weight keys from database
// These keys are not used because token complexity uses a growth-based algorithm

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function deleteTokenSubdimensionKeys() {
  console.log('🗑️  Deleting Token Subdimension Keys from Database...\n');

  const keysToDelete = [
    'ais_token_volume_weight',
    'ais_token_peak_weight',
    'ais_token_io_weight'
  ];

  console.log('📋 Keys to delete:');
  keysToDelete.forEach(key => console.log(`   - ${key}`));
  console.log();

  // First, check if keys exist
  console.log('1️⃣ Checking if keys exist in database...');
  const { data: existingKeys, error: selectError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, category, description')
    .in('config_key', keysToDelete);

  if (selectError) {
    console.error('❌ Error checking existing keys:', selectError);
    return false;
  }

  if (!existingKeys || existingKeys.length === 0) {
    console.log('✅ No token subdimension keys found in database (already deleted or never existed)');
    return true;
  }

  console.log(`📊 Found ${existingKeys.length} keys to delete:`);
  existingKeys.forEach(key => {
    console.log(`   - ${key.config_key}: ${key.config_value} (${key.category})`);
  });
  console.log();

  // Delete the keys
  console.log('2️⃣ Deleting keys from ais_system_config table...');
  const { error: deleteError } = await supabase
    .from('ais_system_config')
    .delete()
    .in('config_key', keysToDelete);

  if (deleteError) {
    console.error('❌ Error deleting keys:', deleteError);
    return false;
  }

  console.log('✅ Successfully deleted all token subdimension keys\n');

  // Verify deletion
  console.log('3️⃣ Verifying deletion...');
  const { data: verifyKeys, error: verifyError } = await supabase
    .from('ais_system_config')
    .select('config_key')
    .in('config_key', keysToDelete);

  if (verifyError) {
    console.error('❌ Error verifying deletion:', verifyError);
    return false;
  }

  if (verifyKeys && verifyKeys.length > 0) {
    console.error('❌ Some keys still exist after deletion:');
    verifyKeys.forEach(key => console.log(`   - ${key.config_key}`));
    return false;
  }

  console.log('✅ Verification passed - all keys successfully deleted\n');

  console.log('='.repeat(80));
  console.log('✅ Token Subdimension Keys Cleanup Complete!');
  console.log('='.repeat(80));
  console.log('📌 Summary:');
  console.log(`   - Deleted ${existingKeys.length} unused database keys`);
  console.log('   - Token complexity uses growth-based algorithm (not weighted averages)');
  console.log('   - Admin UI token subdimension controls already removed');
  console.log('='.repeat(80));

  return true;
}

deleteTokenSubdimensionKeys()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('❌ Script error:', err);
    process.exit(1);
  });
