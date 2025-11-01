// scripts/analyze-pricing-discrepancies.ts
// Find agents that ran with gpt-4o-mini but were recorded as gpt-4o
// Calculate the price difference

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PricingDiscrepancy {
  token_usage_id: string;
  user_id: string;
  agent_id: string | null;
  recorded_model: string;
  actual_model: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  recorded_cost: number;
  correct_cost: number;
  overcharge: number;
  overcharge_percentage: number;
  created_at: string;
}

async function getPricing() {
  const { data, error } = await supabase
    .from('ai_model_pricing')
    .select('provider, model_name, input_cost_per_token, output_cost_per_token')
    .eq('provider', 'openai')
    .in('model_name', ['gpt-4o', 'gpt-4o-mini'])
    .is('retired_date', null);

  if (error) {
    console.error('❌ Error fetching pricing:', error);
    process.exit(1);
  }

  const pricing: any = {};
  data.forEach((p: any) => {
    pricing[p.model_name] = {
      input: parseFloat(p.input_cost_per_token),
      output: parseFloat(p.output_cost_per_token)
    };
  });

  return pricing;
}

async function findDiscrepancies() {
  console.log('🔍 Analyzing pricing discrepancies...\n');

  // Get pricing from database
  const pricing = await getPricing();
  console.log('📊 Current Pricing:');
  console.log('gpt-4o:', pricing['gpt-4o']);
  console.log('gpt-4o-mini:', pricing['gpt-4o-mini']);
  console.log('');

  // Step 1: Get all audit trail records showing gpt-4o-mini was used
  console.log('📋 Step 1: Finding executions that used gpt-4o-mini via intelligent routing...\n');

  const { data: auditRecords, error: auditError } = await supabase
    .from('audit_trail')
    .select('*')
    .eq('action', 'AGENTKIT_EXECUTION_COMPLETED')
    .or('details->>model_used.eq.gpt-4o-mini,details->>model.eq.gpt-4o-mini')
    .order('created_at', { ascending: false })
    .limit(100);

  if (auditError) {
    console.error('❌ Error fetching audit records:', auditError);
    return;
  }

  console.log(`✅ Found ${auditRecords?.length || 0} executions with gpt-4o-mini\n`);

  if (!auditRecords || auditRecords.length === 0) {
    console.log('ℹ️  No intelligent routing executions found yet.');
    console.log('   This might mean:');
    console.log('   1. No agents have run with intelligent routing yet');
    console.log('   2. All agents have HIGH intensity scores (using gpt-4o)');
    console.log('   3. Audit trail is not capturing model_used correctly');
    return;
  }

  // Step 2: For each audit record, find matching token_usage record
  console.log('📋 Step 2: Matching with token_usage records...\n');

  const discrepancies: PricingDiscrepancy[] = [];

  for (const audit of auditRecords) {
    const details = audit.details || {};
    const actualModel = details.model_used || details.model || 'unknown';
    const auditTime = new Date(audit.created_at);
    const totalTokens = parseInt(details.total_tokens) || 0;

    // Find matching token_usage record (within 60 seconds, similar token count)
    const timeStart = new Date(auditTime.getTime() - 60000).toISOString();
    const timeEnd = new Date(auditTime.getTime() + 60000).toISOString();

    const { data: tokenRecords } = await supabase
      .from('token_usage')
      .select('*')
      .eq('user_id', audit.user_id)
      .gte('created_at', timeStart)
      .lte('created_at', timeEnd)
      .limit(5);

    if (!tokenRecords || tokenRecords.length === 0) continue;

    // Find best match by token count
    const bestMatch = tokenRecords.reduce((best, current) => {
      const bestDiff = Math.abs((best?.total_tokens || 0) - totalTokens);
      const currentDiff = Math.abs((current?.total_tokens || 0) - totalTokens);
      return currentDiff < bestDiff ? current : best;
    });

    if (!bestMatch) continue;

    // Check if there's a discrepancy
    if (bestMatch.model_name !== actualModel) {
      // Calculate correct cost
      const correctPricing = pricing[actualModel];
      if (!correctPricing) continue;

      const correctCost =
        (bestMatch.input_tokens * correctPricing.input) +
        (bestMatch.output_tokens * correctPricing.output);

      const overcharge = bestMatch.cost_usd - correctCost;
      const overchargePercentage = ((bestMatch.cost_usd / correctCost) - 1) * 100;

      discrepancies.push({
        token_usage_id: bestMatch.id,
        user_id: bestMatch.user_id,
        agent_id: audit.entity_id,
        recorded_model: bestMatch.model_name,
        actual_model: actualModel,
        total_tokens: bestMatch.total_tokens,
        input_tokens: bestMatch.input_tokens,
        output_tokens: bestMatch.output_tokens,
        recorded_cost: bestMatch.cost_usd,
        correct_cost: correctCost,
        overcharge: overcharge,
        overcharge_percentage: overchargePercentage,
        created_at: bestMatch.created_at
      });
    }
  }

  console.log(`✅ Found ${discrepancies.length} pricing discrepancies\n`);

  if (discrepancies.length === 0) {
    console.log('🎉 Great! No pricing discrepancies found.');
    console.log('   All token_usage records have correct model names.');
    return;
  }

  // Step 3: Display results
  console.log('📊 PRICING DISCREPANCIES FOUND:\n');
  console.log('='.repeat(100));

  discrepancies.forEach((d, i) => {
    console.log(`\n${i + 1}. Record ID: ${d.token_usage_id}`);
    console.log(`   Agent: ${d.agent_id}`);
    console.log(`   Recorded as: ${d.recorded_model}`);
    console.log(`   Actually used: ${d.actual_model}`);
    console.log(`   Tokens: ${d.total_tokens.toLocaleString()} (${d.input_tokens} in / ${d.output_tokens} out)`);
    console.log(`   Recorded cost: $${d.recorded_cost.toFixed(6)}`);
    console.log(`   Correct cost:  $${d.correct_cost.toFixed(6)}`);
    console.log(`   Overcharge:    $${d.overcharge.toFixed(6)} (${d.overcharge_percentage.toFixed(1)}% higher)`);
    console.log(`   Date: ${new Date(d.created_at).toLocaleString()}`);
  });

  console.log('\n' + '='.repeat(100));
  console.log('\n📊 SUMMARY:\n');

  const totalOvercharge = discrepancies.reduce((sum, d) => sum + d.overcharge, 0);
  const totalRecordedCost = discrepancies.reduce((sum, d) => sum + d.recorded_cost, 0);
  const totalCorrectCost = discrepancies.reduce((sum, d) => sum + d.correct_cost, 0);
  const avgOverchargePercent = discrepancies.reduce((sum, d) => sum + d.overcharge_percentage, 0) / discrepancies.length;

  console.log(`Total records affected: ${discrepancies.length}`);
  console.log(`Total recorded cost:    $${totalRecordedCost.toFixed(4)}`);
  console.log(`Total correct cost:     $${totalCorrectCost.toFixed(4)}`);
  console.log(`Total overcharge:       $${totalOvercharge.toFixed(4)}`);
  console.log(`Average overcharge:     ${avgOverchargePercent.toFixed(1)}%`);
  console.log('');

  // Generate update SQL
  console.log('📝 SQL to fix these records:\n');
  console.log('-- Update cost_usd to correct values');
  console.log('-- WARNING: This will modify historical data!\n');

  discrepancies.forEach(d => {
    console.log(`UPDATE token_usage SET cost_usd = ${d.correct_cost.toFixed(8)} WHERE id = '${d.token_usage_id}';`);
  });

  console.log('\n-- Or update model_name to reflect actual model used:\n');

  discrepancies.forEach(d => {
    console.log(`UPDATE token_usage SET model_name = '${d.actual_model}' WHERE id = '${d.token_usage_id}';`);
  });
}

findDiscrepancies()
  .then(() => {
    console.log('\n✅ Analysis complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
