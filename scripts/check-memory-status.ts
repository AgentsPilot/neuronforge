// Quick script to check memory system status
import { createClient } from '@supabase/supabase-js';

async function checkMemoryStatus() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('🔍 Checking Memory System Status...\n');

  // Check run_memories table
  const { data: runMemories, error: runError } = await supabase
    .from('run_memories')
    .select('id, agent_id, run_number, summary, sentiment, importance_score, ais_score, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (runError) {
    console.error('❌ Error querying run_memories:', runError.message);
  } else {
    console.log(`✅ run_memories table: ${runMemories?.length || 0} recent records`);
    if (runMemories && runMemories.length > 0) {
      console.log('\n📊 Sample run memories:');
      runMemories.forEach((mem, i) => {
        console.log(`  ${i + 1}. Run #${mem.run_number} - ${mem.sentiment || 'N/A'} - Score: ${mem.importance_score}`);
        console.log(`     Summary: ${mem.summary.substring(0, 80)}...`);
        console.log(`     Created: ${new Date(mem.created_at).toLocaleString()}`);
      });
    } else {
      console.log('  ⚠️  No run memories found - memory system may not be creating memories');
    }
  }

  // Check user_memory table
  const { data: userMemories, error: userError } = await supabase
    .from('user_memory')
    .select('id, memory_key, memory_value, memory_type, importance, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (userError) {
    console.error('\n❌ Error querying user_memory:', userError.message);
  } else {
    console.log(`\n✅ user_memory table: ${userMemories?.length || 0} recent records`);
    if (userMemories && userMemories.length > 0) {
      console.log('\n👤 Sample user memories:');
      userMemories.forEach((mem, i) => {
        console.log(`  ${i + 1}. ${mem.memory_key} (${mem.memory_type}) - Importance: ${mem.importance}`);
        console.log(`     Value: ${JSON.stringify(mem.memory_value).substring(0, 80)}...`);
      });
    } else {
      console.log('  ⚠️  No user memories found - user preference extraction may not be working');
    }
  }

  // Check memory_config table
  const { data: config, error: configError } = await supabase
    .from('memory_config')
    .select('*')
    .limit(1);

  if (configError) {
    console.error('\n❌ Error querying memory_config:', configError.message);
  } else {
    console.log(`\n✅ memory_config table: ${config?.length || 0} records`);
    if (config && config.length > 0) {
      console.log('  Configuration loaded successfully');
    } else {
      console.log('  ⚠️  No configuration found - using defaults');
    }
  }

  // Count total memories by agent
  const { data: agentStats, error: statsError } = await supabase
    .from('run_memories')
    .select('agent_id')
    .limit(1000);

  if (!statsError && agentStats) {
    const agentCounts = agentStats.reduce((acc: any, mem: any) => {
      acc[mem.agent_id] = (acc[mem.agent_id] || 0) + 1;
      return acc;
    }, {});

    console.log(`\n📈 Memory Distribution:`);
    console.log(`  Total memories: ${agentStats.length}`);
    console.log(`  Unique agents with memories: ${Object.keys(agentCounts).length}`);
  }

  // Check if memory injection is working
  console.log('\n🧪 Testing Memory Injection...');
  const { MemoryInjector } = await import('../lib/memory/MemoryInjector');

  if (runMemories && runMemories.length > 0) {
    const sampleAgentId = runMemories[0].agent_id;
    const injector = new MemoryInjector(supabase);

    try {
      const memoryContext = await injector.buildMemoryContext(
        sampleAgentId,
        'test-user-id',
        { test: 'input' }
      );

      console.log(`  ✅ Memory injection working: ${memoryContext.token_count} tokens`);
      console.log(`     Recent runs: ${memoryContext.recent_runs.length}`);
      console.log(`     User context: ${memoryContext.user_context.length}`);
      console.log(`     Patterns: ${memoryContext.relevant_patterns.length}`);

      if (memoryContext.token_count > 0) {
        console.log('\n  🎉 Memory system is WORKING and injecting context!');
      } else {
        console.log('\n  ⚠️  Memory system loads but returns empty context');
      }
    } catch (error) {
      console.error('  ❌ Error testing memory injection:', error);
    }
  }

  console.log('\n✅ Memory status check complete!\n');
}

checkMemoryStatus().catch(console.error);
