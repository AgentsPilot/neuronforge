import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

async function testClients() {
  // Test 1: Normal client (like AuditTrailService uses)
  const normalClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Test 2: Client with explicit schema and options
  const configuredClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      }
    }
  );

  console.log('Testing normal client (same as AuditTrailService)...\n');

  // Test 1: With user_id
  const { data: data1, error: error1 } = await normalClient
    .from('audit_trail')
    .insert({
      action: 'TEST_NORMAL_CLIENT',
      entity_type: 'test',
      severity: 'info',
      user_id: '39c134b8-fab3-49eb-b05f-c174ce4a8229'
    })
    .select();

  if (error1) {
    console.log('❌ Normal client FAILED (with user_id):', error1.message);
    console.log('   Code:', error1.code);
  } else {
    console.log('✅ Normal client SUCCESS (with user_id)!');
    await normalClient.from('audit_trail').delete().eq('action', 'TEST_NORMAL_CLIENT');
  }

  // Test 2: Without user_id (system event)
  console.log('\nTesting normal client WITHOUT user_id (system event)...\n');

  const { data: data1b, error: error1b } = await normalClient
    .from('audit_trail')
    .insert({
      action: 'TEST_SYSTEM_EVENT',
      entity_type: 'test',
      severity: 'info',
      user_id: null
    })
    .select();

  if (error1b) {
    console.log('❌ Normal client FAILED (without user_id):', error1b.message);
    console.log('   Code:', error1b.code);
  } else {
    console.log('✅ Normal client SUCCESS (without user_id)!');
    await normalClient.from('audit_trail').delete().eq('action', 'TEST_SYSTEM_EVENT');
  }

  console.log('\nTesting configured client...\n');

  const { data: data2, error: error2 } = await configuredClient
    .from('audit_trail')
    .insert({
      action: 'TEST_CONFIGURED_CLIENT',
      entity_type: 'test',
      severity: 'info',
      user_id: '39c134b8-fab3-49eb-b05f-c174ce4a8229'
    })
    .select();

  if (error2) {
    console.log('❌ Configured client FAILED:', error2.message);
    console.log('   Code:', error2.code);
  } else {
    console.log('✅ Configured client SUCCESS!');
    await configuredClient.from('audit_trail').delete().eq('action', 'TEST_CONFIGURED_CLIENT');
  }
}

testClients();
