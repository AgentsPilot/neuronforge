// Script to delete duplicate test agents and all related data
// Run with: npx tsx scripts/delete-duplicate-agents.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const AGENT_IDS_TO_DELETE = [
  '182f2af3-ec0b-4e29-9a34-756efc23bbef',
  '409a1883-9867-4447-ac0e-ebff65bb1cdf',
  '41a50e0e-8d1e-44c6-9d42-ebc3ddac1ab6',
  '4de0d6ab-1c39-46f3-b63d-471c6e2bd380',
  '92a2f997-8322-4d80-ad5a-dcac15fcde32',
  'da2e4ed5-8efd-4ff3-981d-ae0ddeef37b5'
]

async function deleteDuplicateAgents() {
  console.log('🗑️  Starting cleanup of duplicate test agents...')
  console.log(`📋 Agent IDs to delete: ${AGENT_IDS_TO_DELETE.length}`)

  const sql = `
DO $$
DECLARE
  agent_ids uuid[] := ARRAY[
    '182f2af3-ec0b-4e29-9a34-756efc23bbef'::uuid,
    '409a1883-9867-4447-ac0e-ebff65bb1cdf'::uuid,
    '41a50e0e-8d1e-44c6-9d42-ebc3ddac1ab6'::uuid,
    '4de0d6ab-1c39-46f3-b63d-471c6e2bd380'::uuid,
    '92a2f997-8322-4d80-ad5a-dcac15fcde32'::uuid,
    'da2e4ed5-8efd-4ff3-981d-ae0ddeef37b5'::uuid
  ];
  agent_ids_text text[] := ARRAY[
    '182f2af3-ec0b-4e29-9a34-756efc23bbef',
    '409a1883-9867-4447-ac0e-ebff65bb1cdf',
    '41a50e0e-8d1e-44c6-9d42-ebc3ddac1ab6',
    '4de0d6ab-1c39-46f3-b63d-471c6e2bd380',
    '92a2f997-8322-4d80-ad5a-dcac15fcde32',
    'da2e4ed5-8efd-4ff3-981d-ae0ddeef37b5'
  ];
  deleted_count int;
BEGIN
  RAISE NOTICE 'Starting cleanup of duplicate test agents...';

  -- Step 1: Delete workflow_approval_requests
  BEGIN
    DELETE FROM workflow_approval_requests
    WHERE execution_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % workflow_approval_requests', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table workflow_approval_requests does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from workflow_approval_requests: %', SQLERRM;
  END;

  -- Step 2: Delete from audit_trail
  BEGIN
    DELETE FROM audit_trail WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % audit_trail records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table audit_trail does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from audit_trail: %', SQLERRM;
  END;

  -- Step 3: Delete from token_usage
  BEGIN
    DELETE FROM token_usage WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % token_usage records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table token_usage does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from token_usage: %', SQLERRM;
  END;

  -- Step 4: Delete from agent_memory_stats
  BEGIN
    DELETE FROM agent_memory_stats WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agent_memory_stats records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agent_memory_stats does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agent_memory_stats: %', SQLERRM;
  END;

  -- Step 5: Delete from agent_stats
  BEGIN
    DELETE FROM agent_stats WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agent_stats records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agent_stats does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agent_stats: %', SQLERRM;
  END;

  -- Step 6: Delete from agent_logs
  BEGIN
    DELETE FROM agent_logs WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agent_logs records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agent_logs does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agent_logs: %', SQLERRM;
  END;

  -- Step 7: Delete from agent_configuration
  BEGIN
    DELETE FROM agent_configuration WHERE agent_id = ANY(agent_ids_text);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agent_configuration records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agent_configuration does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agent_configuration: %', SQLERRM;
  END;

  -- Step 8: Delete from agent_executions (UUID agent_id)
  BEGIN
    DELETE FROM agent_executions WHERE agent_id = ANY(agent_ids);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agent_executions records', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agent_executions does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agent_executions: %', SQLERRM;
  END;

  -- Step 9: Delete from agents table
  BEGIN
    DELETE FROM agents WHERE id = ANY(agent_ids);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % agents', deleted_count;
  EXCEPTION
    WHEN undefined_table THEN RAISE NOTICE 'Table agents does not exist, skipping...';
    WHEN others THEN RAISE NOTICE 'Error deleting from agents: %', SQLERRM;
  END;

  RAISE NOTICE 'Cleanup completed successfully!';
END $$;
  `

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql })

    if (error) {
      console.error('❌ Error executing cleanup SQL:', error)

      // Fallback: Try direct deletion with proper type handling
      console.log('🔄 Attempting fallback deletion method...')
      await fallbackDeletion()
      return
    }

    console.log('✅ Cleanup SQL executed successfully')

    // Verify cleanup
    await verifyCleanup()

  } catch (error) {
    console.error('❌ Unexpected error:', error)

    // Try fallback method
    console.log('🔄 Attempting fallback deletion method...')
    await fallbackDeletion()
  }
}

async function fallbackDeletion() {
  console.log('📋 Using direct Supabase deletion...')

  let totalDeleted = 0

  // Delete from tables in dependency order
  const tables = [
    { name: 'workflow_approval_requests', column: 'execution_id', type: 'text' },
    { name: 'audit_trail', column: 'agent_id', type: 'text' },
    { name: 'token_usage', column: 'agent_id', type: 'text' },
    { name: 'agent_memory_stats', column: 'agent_id', type: 'text' },
    { name: 'agent_stats', column: 'agent_id', type: 'text' },
    { name: 'agent_logs', column: 'agent_id', type: 'text' },
    { name: 'agent_configuration', column: 'agent_id', type: 'text' },
    { name: 'agent_executions', column: 'agent_id', type: 'uuid' },
    { name: 'agents', column: 'id', type: 'uuid' }
  ]

  for (const table of tables) {
    try {
      const { error, count } = await supabase
        .from(table.name)
        .delete()
        .in(table.column, AGENT_IDS_TO_DELETE)

      if (error) {
        console.log(`⚠️  Could not delete from ${table.name}:`, error.message)
      } else {
        console.log(`✅ Deleted ${count || 0} records from ${table.name}`)
        totalDeleted += (count || 0)
      }
    } catch (err: any) {
      console.log(`⚠️  Error with ${table.name}:`, err.message)
    }
  }

  console.log(`\n📊 Total records deleted: ${totalDeleted}`)

  // Verify cleanup
  await verifyCleanup()
}

async function verifyCleanup() {
  console.log('\n🔍 Verifying cleanup...')

  const { data: remainingAgents, error } = await supabase
    .from('agents')
    .select('id, agent_name, created_at')
    .ilike('agent_name', '%Test Workflow%')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Error verifying cleanup:', error)
    return
  }

  if (!remainingAgents || remainingAgents.length === 0) {
    console.log('⚠️  No test workflow agents found')
    return
  }

  console.log(`\n📋 Remaining test workflow agents: ${remainingAgents.length}`)
  remainingAgents.forEach(agent => {
    console.log(`  - ${agent.agent_name} (${agent.id}) - Created: ${new Date(agent.created_at).toLocaleString()}`)
  })

  // Check if any of the target IDs still exist
  const stillExist = remainingAgents.filter(a => AGENT_IDS_TO_DELETE.includes(a.id))
  if (stillExist.length > 0) {
    console.log(`\n❌ WARNING: ${stillExist.length} agents were not deleted:`)
    stillExist.forEach(a => console.log(`  - ${a.id}: ${a.agent_name}`))
  } else {
    console.log('\n✅ All duplicate agents successfully deleted!')
  }
}

// Run the cleanup
deleteDuplicateAgents()
  .then(() => {
    console.log('\n✅ Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error)
    process.exit(1)
  })
