#!/usr/bin/env tsx
/**
 * Test Memory System Integration
 *
 * This script tests the memory system integration by:
 * 1. Loading memory context for a test agent
 * 2. Verifying memory prompt formatting
 * 3. Checking database connectivity
 *
 * Usage: npx tsx scripts/test-memory-integration.ts
 */

import { createClient } from '@supabase/supabase-js';
import { MemoryInjector } from '../lib/memory/MemoryInjector';
import { MemoryConfigService } from '../lib/memory/MemoryConfigService';

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function testMemoryIntegration() {
  console.log('🧪 Testing Memory System Integration\n');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Test 1: Check database connectivity
    console.log('1️⃣ Testing database connectivity...');
    const { data: configTest, error: configError } = await supabase
      .from('memory_config')
      .select('config_key')
      .limit(1);

    if (configError) {
      console.error('❌ Database connection failed:', configError.message);
      return;
    }
    console.log('✅ Database connected successfully\n');

    // Test 2: Load memory configuration
    console.log('2️⃣ Testing memory configuration loading...');
    const injectionConfig = await MemoryConfigService.getInjectionConfig(supabase);
    console.log('✅ Injection config loaded:', {
      max_tokens: injectionConfig.max_tokens,
      max_recent_runs: injectionConfig.max_recent_runs,
      min_recent_runs: injectionConfig.min_recent_runs
    });
    console.log('');

    // Test 3: Get a sample agent for testing
    console.log('3️⃣ Finding sample agent...');
    const { data: agents, error: agentError } = await supabase
      .from('agents')
      .select('id, agent_name, user_id')
      .limit(1)
      .single();

    if (agentError || !agents) {
      console.log('⚠️  No agents found in database. Create an agent first to test memory injection.');
      console.log('   Memory system is configured and ready to use.\n');
      return;
    }

    console.log(`✅ Found agent: ${agents.agent_name} (${agents.id})\n`);

    // Test 4: Build memory context
    console.log('4️⃣ Testing memory context loading...');
    const memoryInjector = new MemoryInjector(supabase);

    const testInput = {
      userInput: 'Test execution for memory system',
      inputValues: { test: true }
    };

    const memoryContext = await memoryInjector.buildMemoryContext(
      agents.id,
      agents.user_id,
      testInput
    );

    console.log('✅ Memory context loaded:', {
      recent_runs: memoryContext.recent_runs.length,
      relevant_patterns: memoryContext.relevant_patterns.length,
      user_context: memoryContext.user_context.length,
      token_count: memoryContext.token_count
    });
    console.log('');

    // Test 5: Format memory prompt
    console.log('5️⃣ Testing memory prompt formatting...');
    const memoryPrompt = memoryInjector.formatForPrompt(memoryContext);

    if (memoryPrompt) {
      console.log('✅ Memory prompt generated:');
      console.log('---');
      console.log(memoryPrompt.substring(0, 500) + (memoryPrompt.length > 500 ? '...' : ''));
      console.log('---');
    } else {
      console.log('ℹ️  No memory context available (agent has no execution history yet)');
    }
    console.log('');

    // Test 6: Get next run number
    console.log('6️⃣ Testing run number tracking...');
    const nextRunNumber = await memoryInjector.getNextRunNumber(agents.id);
    console.log(`✅ Next run number: ${nextRunNumber}`);
    console.log('');

    // Test 7: Check for existing memories
    console.log('7️⃣ Checking existing memories...');
    const { data: memories, error: memError } = await supabase
      .from('run_memories')
      .select('id, run_number, summary, importance_score')
      .eq('agent_id', agents.id)
      .order('run_timestamp', { ascending: false })
      .limit(3);

    if (memError) {
      console.error('❌ Error fetching memories:', memError.message);
    } else if (memories && memories.length > 0) {
      console.log(`✅ Found ${memories.length} existing memories:`);
      memories.forEach((mem: any) => {
        console.log(`   - Run #${mem.run_number}: ${mem.summary.substring(0, 60)}... (importance: ${mem.importance_score})`);
      });
    } else {
      console.log('ℹ️  No memories found yet. Memories will be created after agent executions.');
    }
    console.log('');

    // Summary
    console.log('🎉 Memory System Integration Test Complete!\n');
    console.log('Summary:');
    console.log('✅ Database connectivity: Working');
    console.log('✅ Memory configuration: Loaded');
    console.log('✅ Memory context loading: Working');
    console.log('✅ Memory prompt formatting: Working');
    console.log('✅ Run number tracking: Working');
    console.log('\nThe memory system is ready to use in agent executions.');
    console.log('Run an agent multiple times to see memory accumulation in action!\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testMemoryIntegration();
