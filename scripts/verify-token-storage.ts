// Verify that database stores raw LLM tokens, not Pilot Credits
// And that conversion to credits only happens in UI
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CheckResult {
  area: string;
  check: string;
  status: 'correct' | 'incorrect' | 'warning';
  details: string;
}

const results: CheckResult[] = [];

async function check1_DatabaseStoresTokens() {
  console.log('\n1️⃣ Checking Database Stores Raw Tokens...\n');

  // Check agent_intensity_metrics table
  const { data: metrics } = await supabase
    .from('agent_intensity_metrics')
    .select('creation_tokens_used, total_tokens_used, avg_tokens_per_run, peak_tokens_single_run')
    .not('creation_tokens_used', 'is', null)
    .limit(5);

  if (metrics && metrics.length > 0) {
    console.log('Sample data from agent_intensity_metrics:');
    metrics.forEach((m, i) => {
      console.log(`  Agent ${i + 1}:`);
      console.log(`    creation_tokens_used: ${m.creation_tokens_used}`);
      console.log(`    total_tokens_used: ${m.total_tokens_used}`);
      console.log(`    avg_tokens_per_run: ${m.avg_tokens_per_run}`);
    });

    // Check if values look like tokens (large numbers) or credits (small numbers)
    const avgCreationTokens = metrics.reduce((sum, m) => sum + (m.creation_tokens_used || 0), 0) / metrics.length;

    if (avgCreationTokens > 100) {
      results.push({
        area: 'Database',
        check: 'Stores raw tokens',
        status: 'correct',
        details: `✅ Avg creation tokens: ${avgCreationTokens.toFixed(0)} (raw LLM tokens, not credits)`
      });
    } else {
      results.push({
        area: 'Database',
        check: 'Stores raw tokens',
        status: 'warning',
        details: `⚠️ Avg creation tokens: ${avgCreationTokens.toFixed(0)} (seems low, might be credits?)`
      });
    }
  } else {
    results.push({
      area: 'Database',
      check: 'Stores raw tokens',
      status: 'warning',
      details: 'No data found to verify'
    });
  }

  // Check token_usage table
  const { data: tokenUsage } = await supabase
    .from('token_usage')
    .select('input_tokens, output_tokens')
    .limit(5);

  if (tokenUsage && tokenUsage.length > 0) {
    console.log('\nSample data from token_usage table:');
    tokenUsage.forEach((t, i) => {
      console.log(`  Record ${i + 1}: input=${t.input_tokens}, output=${t.output_tokens}, total=${t.input_tokens + t.output_tokens}`);
    });

    const avgTotal = tokenUsage.reduce((sum, t) => sum + t.input_tokens + t.output_tokens, 0) / tokenUsage.length;

    if (avgTotal > 50) {
      results.push({
        area: 'Database',
        check: 'token_usage stores raw tokens',
        status: 'correct',
        details: `✅ Avg total tokens: ${avgTotal.toFixed(0)} (raw LLM tokens)`
      });
    } else {
      results.push({
        area: 'Database',
        check: 'token_usage stores raw tokens',
        status: 'warning',
        details: `⚠️ Avg total tokens: ${avgTotal.toFixed(0)} (seems low)`
      });
    }
  }
}

async function check2_CalculationsUseTokens() {
  console.log('\n2️⃣ Checking Calculations Use Raw Tokens...\n');

  const fs = require('fs');

  // Check AgentIntensityService
  const aisService = fs.readFileSync(
    path.resolve(process.cwd(), 'lib/services/AgentIntensityService.ts'),
    'utf-8'
  );

  // Line 89: const pilotCredits = Math.ceil(creationData.tokens_used / 10);
  if (aisService.includes('creationData.tokens_used / 10')) {
    results.push({
      area: 'Calculations',
      check: 'AgentIntensityService calculation',
      status: 'correct',
      details: '✅ Uses tokens_used (raw tokens) then divides by 10 for credits'
    });
  } else {
    results.push({
      area: 'Calculations',
      check: 'AgentIntensityService calculation',
      status: 'incorrect',
      details: '❌ Not converting tokens to credits correctly'
    });
  }

  // Check if it stores tokens_used (not credits)
  if (aisService.includes('creation_tokens_used: creationData.tokens_used')) {
    results.push({
      area: 'Calculations',
      check: 'AgentIntensityService stores raw tokens',
      status: 'correct',
      details: '✅ Stores raw tokens_used in database'
    });
  } else {
    results.push({
      area: 'Calculations',
      check: 'AgentIntensityService stores raw tokens',
      status: 'warning',
      details: '⚠️ Could not verify token storage'
    });
  }

  // Check CreditService
  const creditService = fs.readFileSync(
    path.resolve(process.cwd(), 'lib/services/CreditService.ts'),
    'utf-8'
  );

  // Line 350: const baseCredits = Math.ceil(tokens / 10);
  if (creditService.includes('Math.ceil(tokens / 10)')) {
    results.push({
      area: 'Calculations',
      check: 'CreditService calculation',
      status: 'correct',
      details: '✅ Converts tokens to credits using tokens / 10'
    });
  } else {
    results.push({
      area: 'Calculations',
      check: 'CreditService calculation',
      status: 'incorrect',
      details: '❌ Not converting tokens to credits'
    });
  }
}

async function check3_UIConvertsForDisplay() {
  console.log('\n3️⃣ Checking UI Converts Tokens to Credits for Display...\n');

  const fs = require('fs');

  // Check AgentIntensityCard
  const intensityCard = fs.readFileSync(
    path.resolve(process.cwd(), 'components/agents/AgentIntensityCard.tsx'),
    'utf-8'
  );

  // Should have: Math.ceil(tokens / 10)
  const conversions = (intensityCard.match(/Math\.ceil\([^)]*\/\s*10\)/g) || []).length;

  if (conversions >= 3) {
    results.push({
      area: 'UI',
      check: 'AgentIntensityCard converts for display',
      status: 'correct',
      details: `✅ Found ${conversions} token-to-credit conversions (/ 10)`
    });
  } else {
    results.push({
      area: 'UI',
      check: 'AgentIntensityCard converts for display',
      status: 'warning',
      details: `⚠️ Found only ${conversions} conversions, expected more`
    });
  }

  // Verify it shows "Pilot Credits" label
  if (intensityCard.includes('Pilot Credits') || intensityCard.includes('pilot credits')) {
    results.push({
      area: 'UI',
      check: 'Shows "Pilot Credits" label',
      status: 'correct',
      details: '✅ UI displays "Pilot Credits" to users'
    });
  } else {
    results.push({
      area: 'UI',
      check: 'Shows "Pilot Credits" label',
      status: 'warning',
      details: '⚠️ Could not find "Pilot Credits" label'
    });
  }
}

function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 TOKEN STORAGE & CONVERSION VERIFICATION');
  console.log('='.repeat(80) + '\n');

  const correctCount = results.filter(r => r.status === 'correct').length;
  const incorrectCount = results.filter(r => r.status === 'incorrect').length;
  const warningCount = results.filter(r => r.status === 'warning').length;

  // Group by area
  const areas = [...new Set(results.map(r => r.area))];

  for (const area of areas) {
    console.log(`\n${area}:`);
    console.log('-'.repeat(80));

    const areaResults = results.filter(r => r.area === area);
    for (const result of areaResults) {
      console.log(`  ${result.details}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SUMMARY:\n');
  console.log(`  ✅ Correct: ${correctCount}`);
  console.log(`  ⚠️  Warnings: ${warningCount}`);
  console.log(`  ❌ Incorrect: ${incorrectCount}`);

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 EXPECTED ARCHITECTURE:\n');
  console.log('  1. Database: Stores RAW LLM tokens (e.g., 1234 tokens)');
  console.log('  2. Calculations: Use raw tokens internally');
  console.log('  3. Conversion: tokens ÷ 10 = Pilot Credits');
  console.log('  4. UI: Display Pilot Credits to users (e.g., "123 credits")');
  console.log('  5. Formula: 10 tokens = 1 Pilot Credit\n');

  if (incorrectCount === 0) {
    console.log('🎉 Architecture is CORRECT! Database stores tokens, UI shows credits.\n');
    process.exit(0);
  } else {
    console.log('❌ Architecture has issues - database may be storing credits instead of tokens.\n');
    process.exit(1);
  }
}

async function main() {
  console.log('\n🔍 Verifying Token Storage & Pilot Credit Conversion...\n');
  console.log('Architecture Check:');
  console.log('  ✓ Database should store RAW LLM tokens');
  console.log('  ✓ Calculations should use raw tokens');
  console.log('  ✓ UI should convert tokens → Pilot Credits (÷ 10)');
  console.log('  ✓ 1 Pilot Credit = 10 LLM tokens\n');

  await check1_DatabaseStoresTokens();
  await check2_CalculationsUseTokens();
  await check3_UIConvertsForDisplay();

  printResults();
}

main();
