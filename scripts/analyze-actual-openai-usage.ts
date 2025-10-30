// scripts/analyze-actual-openai-usage.ts
// Analyze actual OpenAI usage from dashboard data

async function analyzeActualUsage() {
  console.log('📊 ANALYZING ACTUAL OPENAI USAGE\n');
  console.log('═'.repeat(80));

  // Actual data from OpenAI dashboard
  const actualData = {
    period: 'Sept 1 - Oct 29, 2025',
    days: 59, // ~2 months
    totalTokens: 1870291,
    totalRequests: 1932
  };

  console.log('\n📈 ACTUAL OPENAI USAGE (from Dashboard)\n');
  console.log('─'.repeat(80));
  console.log(`Period:         ${actualData.period} (${actualData.days} days)`);
  console.log(`Total Tokens:   ${actualData.totalTokens.toLocaleString()}`);
  console.log(`Total Requests: ${actualData.totalRequests.toLocaleString()}`);

  // Calculate averages
  const avgTokensPerRequest = Math.round(actualData.totalTokens / actualData.totalRequests);
  const avgRequestsPerDay = Math.round(actualData.totalRequests / actualData.days);
  const avgTokensPerDay = Math.round(actualData.totalTokens / actualData.days);

  console.log(`\nAverages:`);
  console.log(`  Tokens/Request:  ${avgTokensPerRequest.toLocaleString()}`);
  console.log(`  Requests/Day:    ${avgRequestsPerDay.toLocaleString()}`);
  console.log(`  Tokens/Day:      ${avgTokensPerDay.toLocaleString()}`);

  // Project to monthly
  const monthlyRequests = Math.round((actualData.totalRequests / actualData.days) * 30);
  const monthlyTokens = Math.round((actualData.totalTokens / actualData.days) * 30);

  console.log(`\nMonthly Projection (30 days):`);
  console.log(`  Requests/Month:  ${monthlyRequests.toLocaleString()}`);
  console.log(`  Tokens/Month:    ${monthlyTokens.toLocaleString()}`);

  // Cost calculations
  console.log(`\n\n💰 COST ANALYSIS\n`);
  console.log('═'.repeat(80));

  // Assuming GPT-4o pricing (input + output averaged)
  const gpt4oInputCost = 0.0025; // $2.50 per 1M input tokens
  const gpt4oOutputCost = 0.01;  // $10 per 1M output tokens
  // Average (assuming 60/40 input/output ratio)
  const gpt4oAvgCost = (gpt4oInputCost * 0.6) + (gpt4oOutputCost * 0.4);

  const currentTotalCost = (actualData.totalTokens / 1000000) * gpt4oAvgCost;
  const currentMonthlyCost = (monthlyTokens / 1000000) * gpt4oAvgCost;
  const currentCostPerRequest = currentTotalCost / actualData.totalRequests;

  console.log(`\nCURRENT COSTS (GPT-4o):`);
  console.log(`  Total Cost (${actualData.days} days):  $${currentTotalCost.toFixed(2)}`);
  console.log(`  Monthly Cost (projected):   $${currentMonthlyCost.toFixed(2)}`);
  console.log(`  Cost per Request:           $${currentCostPerRequest.toFixed(4)}`);

  // Calculate with model switch
  // Assuming 50% creation (GPT-4o), 50% execution (Claude Haiku)
  const creationRequests = actualData.totalRequests * 0.5;
  const executionRequests = actualData.totalRequests * 0.5;
  const creationTokens = actualData.totalTokens * 0.5;
  const executionTokens = actualData.totalTokens * 0.5;

  const claudeHaikuInputCost = 0.00025 / 1000;  // $0.25 per 1M tokens
  const claudeHaikuOutputCost = 0.00125 / 1000; // $1.25 per 1M tokens
  const claudeHaikuAvgCost = (claudeHaikuInputCost * 0.6) + (claudeHaikuOutputCost * 0.4);

  const proposedCreationCost = (creationTokens / 1000) * gpt4oAvgCost;
  const proposedExecutionCost = (executionTokens / 1000) * claudeHaikuAvgCost;
  const proposedTotalCost = proposedCreationCost + proposedExecutionCost;

  const proposedMonthlyCost = (proposedTotalCost / actualData.days) * 30;

  console.log(`\n\nPROPOSED COSTS (GPT-4o creation + Claude Haiku execution):`);
  console.log(`  Creation Cost (GPT-4o):     $${proposedCreationCost.toFixed(2)}`);
  console.log(`  Execution Cost (Haiku):     $${proposedExecutionCost.toFixed(2)}`);
  console.log(`  Total Cost (${actualData.days} days):  $${proposedTotalCost.toFixed(2)}`);
  console.log(`  Monthly Cost (projected):   $${proposedMonthlyCost.toFixed(2)}`);

  const savings = currentTotalCost - proposedTotalCost;
  const savingsPercent = (savings / currentTotalCost) * 100;
  const monthlySavings = currentMonthlyCost - proposedMonthlyCost;

  console.log(`\n\n💰 SAVINGS\n`);
  console.log('─'.repeat(80));
  console.log(`Total Savings (${actualData.days} days):  $${savings.toFixed(2)} (${savingsPercent.toFixed(1)}%)`);
  console.log(`Monthly Savings:             $${monthlySavings.toFixed(2)}`);
  console.log(`Annual Savings:              $${(monthlySavings * 12).toFixed(2)}`);

  // Pricing strategy
  console.log(`\n\n🎯 SUSTAINABLE PRICING STRATEGY\n`);
  console.log('═'.repeat(80));

  console.log(`\nBased on ${monthlyRequests.toLocaleString()} requests/month:`);

  // Calculate cost per request with new model
  const newCostPerRequest = proposedMonthlyCost / monthlyRequests;

  console.log(`\nCost per Request (with Haiku): $${newCostPerRequest.toFixed(4)}`);

  // Pricing tiers with healthy margins
  const tiers = [
    { name: 'Free', requests: 100, price: 0, targetMargin: 0 },
    { name: 'Starter', requests: 500, price: 15, targetMargin: 70 },
    { name: 'Professional', requests: 2000, price: 40, targetMargin: 70 },
    { name: 'Business', requests: 6000, price: 100, targetMargin: 70 },
    { name: 'Enterprise', requests: 15000, price: 250, targetMargin: 70 },
  ];

  console.log(`\n\nRECOMMENDED PRICING TIERS:\n`);

  tiers.forEach(tier => {
    const cost = tier.requests * newCostPerRequest;
    const revenue = tier.price;
    const profit = revenue - cost;
    const actualMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    console.log(`${tier.name}:`);
    console.log(`  Price: $${tier.price}/month`);
    console.log(`  Included: ${tier.requests.toLocaleString()} requests`);
    console.log(`  LLM Cost: $${cost.toFixed(2)}`);
    console.log(`  Gross Profit: $${profit.toFixed(2)}`);
    console.log(`  Margin: ${actualMargin.toFixed(1)}% ${actualMargin >= 60 ? '✅' : actualMargin >= 40 ? '⚠️' : '❌'}`);
    console.log(``);
  });

  // Real world usage
  console.log(`\n\n🌍 WHAT USERS CAN DO WITH EACH TIER\n`);
  console.log('═'.repeat(80));

  tiers.filter(t => t.price > 0).forEach(tier => {
    console.log(`\n${tier.name} - $${tier.price}/month (${tier.requests} requests):`);

    const scenarios = [
      { agents: 1, runsPerDay: Math.floor(tier.requests / 30) },
      { agents: 3, runsPerDay: Math.floor(tier.requests / 30 / 3) },
      { agents: 5, runsPerDay: Math.floor(tier.requests / 30 / 5) },
      { agents: 10, runsPerDay: Math.floor(tier.requests / 30 / 10) },
    ];

    scenarios.forEach(s => {
      if (s.runsPerDay >= 1) {
        const frequency = s.runsPerDay >= 10 ? 'hourly+' : s.runsPerDay >= 3 ? 'several times daily' : 'daily';
        console.log(`  • ${s.agents} agent${s.agents > 1 ? 's' : ''}: ${s.runsPerDay} runs/day each (${frequency})`);
      }
    });
  });

  // Competitive comparison
  console.log(`\n\n📊 COMPETITIVE COMPARISON\n`);
  console.log('═'.repeat(80));

  const competitors = [
    { name: 'Zapier Starter', price: 19.99, runs: 750 },
    { name: 'Make Core', price: 9, runs: 10000 },
    { name: 'n8n Starter', price: 20, runs: 2500 },
    { name: 'Relay.app Pro', price: 25, runs: 5000 },
  ];

  console.log(`\nYour Pricing vs Competition:\n`);
  competitors.forEach(comp => {
    const pricePerRun = comp.price / comp.runs;
    console.log(`${comp.name.padEnd(20)} $${String(comp.price).padStart(6)}/mo → ${String(comp.runs).padStart(6)} runs → $${pricePerRun.toFixed(4)}/run`);
  });

  console.log(`\nYour Tiers (for comparison):\n`);
  tiers.filter(t => t.price > 0).forEach(tier => {
    const pricePerRun = tier.price / tier.requests;
    console.log(`${tier.name.padEnd(20)} $${String(tier.price).padStart(6)}/mo → ${String(tier.requests).padStart(6)} runs → $${pricePerRun.toFixed(4)}/run`);
  });

  // Final recommendation
  console.log(`\n\n✅ FINAL RECOMMENDATION\n`);
  console.log('═'.repeat(80));

  console.log(`\n1. SWITCH TO CLAUDE HAIKU for agent execution`);
  console.log(`   • Save $${monthlySavings.toFixed(2)}/month (${savingsPercent.toFixed(1)}%)`);
  console.log(`   • Annual savings: $${(monthlySavings * 12).toFixed(2)}`);

  console.log(`\n2. IMPLEMENT THESE PRICING TIERS:`);
  console.log(`   • Free:         $0/mo    →   100 requests`);
  console.log(`   • Starter:     $15/mo    →   500 requests (~70% margin)`);
  console.log(`   • Professional: $40/mo    → 2,000 requests (~70% margin)`);
  console.log(`   • Business:    $100/mo   → 6,000 requests (~70% margin)`);
  console.log(`   • Enterprise:  $250/mo   → 15,000 requests (~70% margin)`);

  console.log(`\n3. COMPETITIVE POSITIONING:`);
  console.log(`   • Similar to competitors (Zapier, Make, n8n)`);
  console.log(`   • Differentiate on "AI-powered agents" vs simple automation`);
  console.log(`   • Unlimited agents (vs per-workflow pricing)`);
  console.log(`   • Credits rollover forever`);

  console.log(`\n4. NEXT STEPS:`);
  console.log(`   a. Add ANTHROPIC_API_KEY to environment`);
  console.log(`   b. Create Anthropic provider`);
  console.log(`   c. Update AgentKit to use Claude Haiku`);
  console.log(`   d. Test with 5-10 existing agents`);
  console.log(`   e. Monitor quality and errors for 1 week`);
  console.log(`   f. Deploy to production`);
  console.log(`   g. Update pricing page and database\n`);
}

analyzeActualUsage().catch(console.error);
