// Test Pilot Credit calculation
// Run with: npx tsx scripts/test-pilot-credit-calculation.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCalculation() {
  console.log('\n🧪 Testing Pilot Credit Calculation\n');

  // 1. Check config values
  const { data: config, error } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description, unit')
    .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

  if (error) {
    console.error('❌ Error fetching config:', error);
    return;
  }

  console.log('📋 Configuration Values:');
  config?.forEach(c => {
    console.log(`  ${c.config_key}: ${c.config_value} ${c.unit || ''}`);
    console.log(`    Description: ${c.description}`);
  });

  const configMap = new Map(config?.map(c => [c.config_key, c.config_value]) || []);
  const pilotCreditCostUsd = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
  const tokensPerCredit = parseInt(configMap.get('tokens_per_pilot_credit') || '10');

  console.log(`\n💰 Using values:`);
  console.log(`  Pilot Credit Cost: $${pilotCreditCostUsd} per credit`);
  console.log(`  Tokens per Credit: ${tokensPerCredit} tokens = 1 credit`);

  // 2. Test calculation
  const testCases = [
    { tokens: 100, description: '100 tokens (small operation)' },
    { tokens: 1000, description: '1,000 tokens (medium operation)' },
    { tokens: 10000, description: '10,000 tokens (large operation)' },
    { tokens: 50000, description: '50,000 tokens (very large operation)' },
  ];

  console.log(`\n📊 Test Calculations:\n`);
  testCases.forEach(({ tokens, description }) => {
    const pilotCredits = Math.ceil(tokens / tokensPerCredit);
    const cost = pilotCredits * pilotCreditCostUsd;
    console.log(`  ${description}:`);
    console.log(`    = ${pilotCredits} Pilot Credits`);
    console.log(`    = $${cost.toFixed(6)}`);
    console.log('');
  });

  // 3. Check actual token usage data
  const { data: tokenUsage, error: usageError } = await supabase
    .from('token_usage')
    .select('total_tokens, cost_usd, activity_name, activity_type')
    .order('created_at', { ascending: false })
    .limit(5);

  if (usageError) {
    console.error('❌ Error fetching token usage:', usageError);
    return;
  }

  console.log(`\n📈 Sample of Recent Token Usage (comparing LLM cost vs Pilot Credit cost):\n`);
  tokenUsage?.forEach((usage, idx) => {
    const pilotCredits = Math.ceil((usage.total_tokens || 0) / tokensPerCredit);
    const pilotCost = pilotCredits * pilotCreditCostUsd;
    const llmCost = usage.cost_usd || 0;

    console.log(`${idx + 1}. ${usage.activity_type || usage.activity_name}`);
    console.log(`   Tokens: ${usage.total_tokens}`);
    console.log(`   LLM API Cost: $${llmCost.toFixed(6)}`);
    console.log(`   Pilot Credit Cost: $${pilotCost.toFixed(6)} (${pilotCredits} credits)`);
    console.log(`   Ratio: ${(pilotCost / llmCost).toFixed(2)}x ${pilotCost > llmCost ? 'MORE' : 'LESS'} expensive`);
    console.log('');
  });

  // 4. Check if formula seems reasonable
  console.log('\n💡 Analysis:');
  console.log(`   Formula: Math.ceil(tokens / ${tokensPerCredit}) × $${pilotCreditCostUsd}`);
  console.log(`   Example: 1000 tokens = ${Math.ceil(1000 / tokensPerCredit)} credits = $${(Math.ceil(1000 / tokensPerCredit) * pilotCreditCostUsd).toFixed(6)}`);
  console.log('');
}

testCalculation().catch(console.error);
