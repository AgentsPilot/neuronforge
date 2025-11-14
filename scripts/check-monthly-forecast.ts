// Check Monthly Forecast Calculation
// Run with: npx tsx scripts/check-monthly-forecast.ts

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkForecast() {
  console.log('\n💰 Monthly Forecast Analysis\n');

  // Get Pilot Credit config
  const { data: config } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

  const configMap = new Map(config?.map(c => [c.config_key, c.config_value]) || []);
  const pilotCreditCostUsd = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
  const tokensPerCredit = parseInt(configMap.get('tokens_per_pilot_credit') || '10');

  console.log('📋 Pilot Credit Config:');
  console.log(`  Cost per credit: $${pilotCreditCostUsd}`);
  console.log(`  Tokens per credit: ${tokensPerCredit}`);
  console.log('');

  // Get user's token usage grouped by day
  const { data: usage, error } = await supabase
    .from('token_usage')
    .select('created_at, total_tokens, cost_usd')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !usage) {
    console.error('❌ Error fetching usage:', error);
    return;
  }

  // Group by day
  const dailyGroups = new Map<string, { tokens: number; llmCost: number }>();

  usage.forEach(item => {
    const date = item.created_at.split('T')[0];
    const current = dailyGroups.get(date) || { tokens: 0, llmCost: 0 };
    dailyGroups.set(date, {
      tokens: current.tokens + (item.total_tokens || 0),
      llmCost: current.llmCost + (item.cost_usd || 0)
    });
  });

  // Convert to array and sort by date
  const dailyData = Array.from(dailyGroups.entries())
    .map(([date, data]) => {
      const pilotCredits = Math.ceil(data.tokens / tokensPerCredit);
      const pilotCost = pilotCredits * pilotCreditCostUsd;
      return {
        date,
        tokens: data.tokens,
        llmCost: data.llmCost,
        pilotCost,
        pilotCredits,
        multiplier: data.llmCost > 0 ? (pilotCost / data.llmCost) : 0
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  console.log('📊 Last 14 Days of Activity:\n');
  console.log('Date       | Tokens    | LLM Cost  | Pilot Cost | Credits | Multiplier');
  console.log('-----------|-----------|-----------|------------|---------|------------');

  dailyData.slice(0, 14).forEach(day => {
    console.log(
      `${day.date} | ${day.tokens.toString().padStart(9)} | $${day.llmCost.toFixed(4).padStart(8)} | $${day.pilotCost.toFixed(4).padStart(9)} | ${day.pilotCredits.toString().padStart(7)} | ${day.multiplier.toFixed(1)}x`
    );
  });

  // Calculate last 7 days
  const last7Days = dailyData.slice(0, 7);
  const weekTotal = last7Days.reduce((sum, d) => sum + d.pilotCost, 0);
  const avgDaily = weekTotal / Math.max(last7Days.length, 1);
  const monthlyProjection = avgDaily * 30;

  console.log('\n📈 Forecast Calculation:\n');
  console.log(`  Last 7 days total: $${weekTotal.toFixed(2)}`);
  console.log(`  Days with data: ${last7Days.length}`);
  console.log(`  Average per day: $${avgDaily.toFixed(2)}`);
  console.log(`  Monthly projection (×30): $${monthlyProjection.toFixed(2)}`);
  console.log('');

  // Show LLM comparison
  const weekLLMTotal = last7Days.reduce((sum, d) => sum + d.llmCost, 0);
  const avgDailyLLM = weekLLMTotal / Math.max(last7Days.length, 1);
  const monthlyLLMProjection = avgDailyLLM * 30;

  console.log('💡 Comparison with LLM Costs:\n');
  console.log(`  Last 7 days LLM cost: $${weekLLMTotal.toFixed(2)}`);
  console.log(`  Monthly LLM projection: $${monthlyLLMProjection.toFixed(2)}`);
  console.log(`  Pilot Credit markup: ${(monthlyProjection / monthlyLLMProjection).toFixed(1)}x`);
  console.log('');

  // Recommendations
  console.log('💭 Analysis:\n');
  if (monthlyProjection > 100) {
    console.log('  ⚠️  High monthly projection detected!');
    console.log('  Possible reasons:');
    console.log('    • High activity in the last 7 days');
    console.log('    • Pilot Credit pricing includes margin (typically 10-20x LLM costs)');
    console.log('    • Large token usage from agent operations');
  }

  if (last7Days.length < 7) {
    console.log(`  ⚠️  Only ${last7Days.length} days of data - projection may be inaccurate`);
  }

  console.log('');
}

checkForecast().catch(console.error);
