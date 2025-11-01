/**
 * Test Script: Agent Sharing Validation with Database Configuration
 *
 * This script tests that the agent sharing validation system correctly:
 * 1. Loads configuration from reward_settings table
 * 2. Validates against database-driven thresholds
 * 3. Enforces all quality and limit checks
 *
 * Usage: npx tsx scripts/test-agent-sharing-validation.ts
 */

import { createClient } from '@supabase/supabase-js';
import { AgentSharingValidator } from '@/lib/credits/agentSharingValidation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAgentSharingValidation() {
  console.log('🧪 Testing Agent Sharing Validation System\n');
  console.log('='.repeat(60));

  // Step 1: Verify database configuration
  console.log('\n📋 Step 1: Verify Database Configuration');
  console.log('-'.repeat(60));

  const { data: rewardConfig } = await supabase
    .from('reward_config')
    .select('id, reward_key, credits_amount, max_per_user_per_day, is_active')
    .eq('reward_key', 'agent_sharing')
    .single();

  if (!rewardConfig) {
    console.error('❌ FAIL: agent_sharing reward not found in reward_config');
    return;
  }

  console.log('✅ Reward Config:', {
    id: rewardConfig.id,
    credits: rewardConfig.credits_amount,
    dailyLimit: rewardConfig.max_per_user_per_day,
    active: rewardConfig.is_active
  });

  const { data: settings } = await supabase
    .from('reward_settings')
    .select('*')
    .eq('reward_config_id', rewardConfig.id)
    .single();

  if (!settings) {
    console.log('⚠️  No reward_settings found - will use defaults');
  } else {
    console.log('✅ Reward Settings:', {
      minExecutions: settings.min_executions,
      minSuccessRate: settings.min_success_rate,
      requireDescription: settings.require_description,
      minDescLength: settings.min_description_length,
      minAgentAge: settings.min_agent_age_hours,
      maxMonthly: settings.max_shares_per_month,
      maxTotal: settings.max_total_shares
    });
  }

  // Step 2: Test validator loads config from database
  console.log('\n🔧 Step 2: Test Validator Initialization');
  console.log('-'.repeat(60));

  const validator = new AgentSharingValidator(supabase);
  const config = validator.getConfig();

  console.log('✅ Validator initialized with config:', {
    minExecutions: config.minExecutions,
    minSuccessRate: config.minSuccessRate,
    maxSharesPerDay: config.maxSharesPerDay,
    maxSharesPerMonth: config.maxSharesPerMonth,
    maxTotalShares: config.maxTotalShares,
    minAgentAgeHours: config.minAgentAgeHours
  });

  // Verify config matches database (after loading)
  // Need to trigger a validation to load config
  console.log('\n🔍 Step 3: Trigger Config Load from Database');
  console.log('-'.repeat(60));

  // Get a test agent (any agent will do for config loading)
  const { data: testAgent } = await supabase
    .from('agents')
    .select('id')
    .limit(1)
    .single();

  if (!testAgent) {
    console.log('⚠️  No agents found in database - skipping validation test');
  } else {
    // This will trigger loadConfigFromDatabase()
    await validator.validateAgentQuality(testAgent.id);

    const loadedConfig = validator.getConfig();
    console.log('✅ Config loaded from database:', loadedConfig);

    // Verify it matches database settings
    if (settings) {
      const matches = {
        minExecutions: loadedConfig.minExecutions === settings.min_executions,
        minSuccessRate: loadedConfig.minSuccessRate === settings.min_success_rate,
        maxSharesPerDay: loadedConfig.maxSharesPerDay === rewardConfig.max_per_user_per_day,
        maxSharesPerMonth: loadedConfig.maxSharesPerMonth === settings.max_shares_per_month,
        maxTotalShares: loadedConfig.maxTotalShares === settings.max_total_shares,
        minAgentAgeHours: loadedConfig.minAgentAgeHours === settings.min_agent_age_hours
      };

      const allMatch = Object.values(matches).every(m => m);

      if (allMatch) {
        console.log('✅ All config values match database!');
      } else {
        console.log('❌ Config mismatch detected:');
        Object.entries(matches).forEach(([key, match]) => {
          if (!match) {
            console.log(`  ❌ ${key}: DB=${(settings as any)[key] || (rewardConfig as any)[key]}, Loaded=${(loadedConfig as any)[key]}`);
          }
        });
      }
    }
  }

  // Step 4: Test validation rules
  console.log('\n🧪 Step 4: Test Validation Rules');
  console.log('-'.repeat(60));

  // Get an agent to test with
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, user_id, description, created_at')
    .limit(5);

  if (!agents || agents.length === 0) {
    console.log('⚠️  No agents found for validation testing');
  } else {
    console.log(`\nTesting with ${agents.length} agents:\n`);

    for (const agent of agents) {
      console.log(`\n📝 Agent: ${agent.agent_name} (${agent.id})`);

      // Get execution count
      const { data: executions } = await supabase
        .from('agent_executions')
        .select('status')
        .eq('agent_id', agent.id);

      const totalExecs = executions?.length || 0;
      const successExecs = executions?.filter(e =>
        e.status === 'success' || e.status === 'completed' || e.status === 'finished'
      ).length || 0;
      const successRate = totalExecs > 0 ? (successExecs / totalExecs) * 100 : 0;

      console.log(`   Executions: ${totalExecs} (${successExecs} successful, ${successRate.toFixed(1)}%)`);
      console.log(`   Description: ${agent.description ? agent.description.length + ' chars' : 'none'}`);

      const agentAge = (Date.now() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60);
      console.log(`   Age: ${agentAge.toFixed(1)} hours`);

      // Test validation
      const result = await validator.validateAgentQuality(agent.id);

      if (result.valid) {
        console.log('   ✅ VALID - meets all requirements');
      } else {
        console.log(`   ❌ INVALID - ${result.reason}`);
      }
    }
  }

  // Step 5: Test user limits
  console.log('\n\n👥 Step 5: Test User Sharing Limits');
  console.log('-'.repeat(60));

  const { data: users } = await supabase
    .from('users')
    .select('id, email')
    .limit(3);

  if (!users || users.length === 0) {
    console.log('⚠️  No users found for limit testing');
  } else {
    for (const user of users) {
      console.log(`\n📧 User: ${user.email}`);

      const status = await validator.getSharingStatus(user.id);
      console.log(`   Shares (24h): ${status.sharesLast24h}/${status.limits.daily}`);
      console.log(`   Shares (30d): ${status.sharesLast30d}/${status.limits.monthly}`);
      console.log(`   Total shares: ${status.totalShares}/${status.limits.lifetime}`);

      const limitsResult = await validator.validateUserLimits(user.id);
      if (limitsResult.valid) {
        console.log('   ✅ Within limits');
      } else {
        console.log(`   ❌ Limit exceeded: ${limitsResult.reason}`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ Test Complete!');
  console.log('='.repeat(60));
  console.log('\nKey Findings:');
  console.log(`  • Reward credits: ${rewardConfig.credits_amount}`);
  console.log(`  • Daily limit: ${rewardConfig.max_per_user_per_day}`);
  if (settings) {
    console.log(`  • Min executions: ${settings.min_executions}`);
    console.log(`  • Min success rate: ${settings.min_success_rate}%`);
    console.log(`  • Min description: ${settings.min_description_length} chars`);
    console.log(`  • Min agent age: ${settings.min_agent_age_hours} hours`);
    console.log(`  • Monthly limit: ${settings.max_shares_per_month}`);
    console.log(`  • Lifetime limit: ${settings.max_total_shares}`);
  }
}

// Run the test
testAgentSharingValidation()
  .then(() => {
    console.log('\n✅ Test script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test script failed:', error);
    process.exit(1);
  });
