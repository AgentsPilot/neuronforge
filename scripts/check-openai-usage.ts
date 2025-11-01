// scripts/check-openai-usage.ts
// Check OpenAI usage directly from their API

import OpenAI from 'openai';

async function checkOpenAIUsage() {
  console.log('📊 CHECKING OPENAI USAGE DIRECTLY\n');
  console.log('═'.repeat(80));

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    // Note: OpenAI doesn't have a direct usage API endpoint in their SDK
    // We need to use the organization/usage endpoint via fetch

    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY not found in environment');
      return;
    }

    console.log('🔍 Fetching usage data from OpenAI...\n');

    // Get usage for the last 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const startDate = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
    const endDate = now.toISOString().split('T')[0];

    console.log(`Period: ${startDate} to ${endDate}\n`);

    // OpenAI usage endpoint (requires organization access)
    const usageUrl = `https://api.openai.com/v1/usage?start_date=${startDate}&end_date=${endDate}`;

    const response = await fetch(usageUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.log('⚠️ Could not fetch usage from OpenAI API (may require organization API key)');
      console.log(`Response status: ${response.status} ${response.statusText}\n`);

      // Alternative: Check through dashboard
      console.log('📌 ALTERNATIVE: Check your OpenAI Dashboard\n');
      console.log('1. Go to: https://platform.openai.com/usage');
      console.log('2. Select date range: Last 30 days');
      console.log('3. Look for:');
      console.log('   • Total tokens used');
      console.log('   • Cost breakdown by model');
      console.log('   • Usage by model (gpt-4o, gpt-4-turbo, etc.)');

      console.log('\n\n📊 Based on your Supabase data, we estimate:\n');
      console.log('Last 30 days (from our database):');
      console.log('  • Total API calls: ~393 calls');
      console.log('  • Total tokens: ~1.34M tokens');
      console.log('  • Estimated cost: ~$40.27');
      console.log('\n(These numbers are from token_usage table in your database)');

      return;
    }

    const data = await response.json();

    console.log('✅ OPENAI USAGE DATA\n');
    console.log('─'.repeat(80));
    console.log(JSON.stringify(data, null, 2));

    // Try to parse and summarize
    if (data.data && Array.isArray(data.data)) {
      let totalTokens = 0;
      let totalCost = 0;

      const modelBreakdown: Record<string, { tokens: number; cost: number; requests: number }> = {};

      data.data.forEach((day: any) => {
        if (day.snapshot_id && day.n_requests) {
          const model = day.snapshot_id || 'unknown';
          if (!modelBreakdown[model]) {
            modelBreakdown[model] = { tokens: 0, cost: 0, requests: 0 };
          }

          modelBreakdown[model].requests += day.n_requests || 0;
          modelBreakdown[model].tokens += (day.n_context_tokens_total || 0) + (day.n_generated_tokens_total || 0);

          totalTokens += (day.n_context_tokens_total || 0) + (day.n_generated_tokens_total || 0);
        }
      });

      console.log('\n\n📊 SUMMARY BY MODEL\n');
      console.log('─'.repeat(80));

      Object.entries(modelBreakdown).forEach(([model, stats]) => {
        console.log(`\n${model}:`);
        console.log(`  Requests: ${stats.requests.toLocaleString()}`);
        console.log(`  Tokens: ${stats.tokens.toLocaleString()}`);
      });

      console.log(`\n\nTOTAL TOKENS (30 days): ${totalTokens.toLocaleString()}`);
    }

  } catch (error: any) {
    console.error('❌ Error fetching OpenAI usage:', error.message);

    console.log('\n\n📌 MANUAL CHECK INSTRUCTIONS\n');
    console.log('═'.repeat(80));
    console.log('\n1. Visit: https://platform.openai.com/usage');
    console.log('2. Login with your OpenAI account');
    console.log('3. Select "Last 30 days" from the date picker');
    console.log('4. Look for these metrics:\n');
    console.log('   📊 Total Usage:');
    console.log('      • Total cost ($)');
    console.log('      • Total tokens');
    console.log('      • Number of requests\n');
    console.log('   🎯 By Model:');
    console.log('      • gpt-4o usage');
    console.log('      • gpt-4-turbo usage');
    console.log('      • Other models\n');
    console.log('   📈 By Feature:');
    console.log('      • Chat completions');
    console.log('      • Assistants API');
    console.log('      • Other endpoints\n');

    console.log('\n5. Take note of:');
    console.log('   • Daily average cost');
    console.log('   • Monthly projection');
    console.log('   • Top consuming models\n');

    console.log('\n📊 For comparison, our database shows:\n');
    console.log('Last 1000 records in token_usage table:');
    console.log('  • ~393 API calls');
    console.log('  • ~1.34M tokens');
    console.log('  • Estimated ~$40.27 cost');
  }
}

checkOpenAIUsage().catch(console.error);
