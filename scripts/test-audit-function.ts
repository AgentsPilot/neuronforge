/**
 * Test the new insert_audit_log database function
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUR_USER_ID = '08456106-aa50-4810-b12c-7ca84102da31';

async function testAuditFunction() {
  console.log('\n🧪 Testing insert_audit_log database function\n');
  console.log('='.repeat(80));

  try {
    // Call the database function via RPC
    const { data, error } = await supabase.rpc('insert_audit_log', {
      p_action: 'TEST_FUNCTION_WITH_USER_ID',
      p_entity_type: 'test',
      p_severity: 'info',
      p_user_id: YOUR_USER_ID,
      p_details: { test: 'Using database function to bypass PostgREST', timestamp: new Date().toISOString() }
    });

    if (error) {
      console.log('❌ Function call FAILED:', error.message);
      console.log('   Code:', error.code);
      console.log('   Make sure you ran the migration first!');
      return;
    }

    console.log('✅ Function call SUCCEEDED!');
    console.log('   Returned log ID:', data);

    // Verify the log was created
    const { data: logData, error: fetchError } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('id', data)
      .single();

    if (fetchError) {
      console.log('   ⚠️  Could not fetch the created log:', fetchError.message);
    } else {
      console.log('\n📋 Created audit log:');
      console.log('   ID:', logData.id);
      console.log('   Action:', logData.action);
      console.log('   User ID:', logData.user_id);
      console.log('   Created at:', logData.created_at);
      console.log('   Details:', logData.details);
    }

    // Clean up
    await supabase.from('audit_trail').delete().eq('action', 'TEST_FUNCTION_WITH_USER_ID');
    console.log('\n   (Test log cleaned up)');

    console.log('\n✅ The database function works! This can be our solution.\n');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testAuditFunction().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
