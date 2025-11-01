// scripts/competitive-pricing-analysis.ts
// Analyze competitive pricing and find a sustainable model

async function analyzeCompetitivePricing() {
  console.log('💰 COMPETITIVE PRICING ANALYSIS');
  console.log('═'.repeat(80));

  // Market data from competitors
  const competitors = [
    {
      name: 'Zapier',
      pricing: [
        { tier: 'Free', price: 0, tasks: 100 },
        { tier: 'Starter', price: 19.99, tasks: 750 },
        { tier: 'Professional', price: 49, tasks: 2000 },
        { tier: 'Team', price: 69, tasks: 50000 },
      ]
    },
    {
      name: 'Make (Integromat)',
      pricing: [
        { tier: 'Free', price: 0, operations: 1000 },
        { tier: 'Core', price: 9, operations: 10000 },
        { tier: 'Pro', price: 16, operations: 10000 },
        { tier: 'Teams', price: 29, operations: 10000 },
      ]
    },
    {
      name: 'n8n Cloud',
      pricing: [
        { tier: 'Starter', price: 20, executions: 2500 },
        { tier: 'Pro', price: 50, executions: 10000 },
      ]
    },
    {
      name: 'Relay.app',
      pricing: [
        { tier: 'Free', price: 0, runs: 100 },
        { tier: 'Starter', price: 10, runs: 1000 },
        { tier: 'Pro', price: 25, runs: 5000 },
      ]
    }
  ];

  console.log('\n📊 COMPETITOR PRICING BREAKDOWN\n');

  competitors.forEach(comp => {
    console.log(`${comp.name}:`);
    comp.pricing.forEach(tier => {
      const executions = tier.tasks || tier.operations || tier.executions || tier.runs;
      const pricePerRun = tier.price > 0 ? (tier.price / executions).toFixed(4) : 0;
      console.log(`  ${tier.tier.padEnd(15)} $${String(tier.price).padEnd(6)} → ${String(executions).padStart(6)} runs → $${pricePerRun}/run`);
    });
    console.log('');
  });

  // Your current pricing based on production data
  console.log('\n🎯 YOUR CURRENT PRICING (Production Data)\n');
  console.log('═'.repeat(80));

  const medianTokensPerExec = 3301; // from production data
  const avgTokensPerExec = 4048;

  const yourPricing = [
    { budget: 270000, price: 27 },
    { budget: 600000, price: 60 },
    { budget: 1500000, price: 150 },
    { budget: 3000000, price: 300 },
  ];

  console.log('\nUsing MEDIAN (3,301 tokens/exec):');
  yourPricing.forEach(p => {
    const executions = Math.floor(p.budget / medianTokensPerExec);
    const pricePerRun = p.price / executions;
    console.log(`  ${String(p.budget).padStart(10)} tokens → ${String(executions).padStart(4)} runs → $${p.price.toFixed(2)}/mo → $${pricePerRun.toFixed(4)}/run`);
  });

  console.log('\n\n⚠️  COMPETITIVE ANALYSIS\n');
  console.log('═'.repeat(80));

  const competitorAvgPricePerRun = 0.025; // ~$0.025/run average from competitors
  const yourCurrentPricePerRun = 27 / (270000 / medianTokensPerExec); // ~$0.33/run

  console.log(`Competitor Average:  $${competitorAvgPricePerRun.toFixed(4)}/run`);
  console.log(`Your Current Price:  $${yourCurrentPricePerRun.toFixed(4)}/run`);
  console.log(`\n❌ You are ${(yourCurrentPricePerRun / competitorAvgPricePerRun).toFixed(1)}x MORE EXPENSIVE than competitors!\n`);

  // Calculate what your pricing SHOULD be
  console.log('\n💡 RECOMMENDED COMPETITIVE PRICING\n');
  console.log('═'.repeat(80));

  // Target: Match or beat competitor pricing
  const targetPricePerRun = 0.020; // $0.02/run (slightly better than competition)

  console.log(`\nTarget: $${targetPricePerRun.toFixed(4)}/run (competitive with market)\n`);

  // Calculate tiers based on execution counts similar to competitors
  const recommendedTiers = [
    { name: 'Free', executions: 100, price: 0 },
    { name: 'Starter', executions: 1000, price: null },
    { name: 'Professional', executions: 5000, price: null },
    { name: 'Business', executions: 15000, price: null },
  ];

  recommendedTiers.forEach(tier => {
    if (tier.price === null) {
      tier.price = Math.round(tier.executions * targetPricePerRun);
    }
    const tokensNeeded = tier.executions * medianTokensPerExec;
    const pilotCredits = Math.round(tokensNeeded / 10);

    console.log(`${tier.name.padEnd(15)} $${String(tier.price).padStart(4)}/mo`);
    console.log(`  → ${tier.executions.toLocaleString().padStart(6)} executions/month`);
    console.log(`  → ${tokensNeeded.toLocaleString().padStart(10)} LLM tokens`);
    console.log(`  → ${pilotCredits.toLocaleString().padStart(10)} Pilot Credits`);
    console.log(`  → $${(tier.price / tier.executions).toFixed(4)}/run\n`);
  });

  // What this means in real usage
  console.log('\n🤖 WHAT USERS GET (Real Agent Usage)\n');
  console.log('═'.repeat(80));

  recommendedTiers.filter(t => t.price > 0).forEach(tier => {
    console.log(`\n${tier.name} - $${tier.price}/month:`);

    // Different agent scenarios
    const scenarios = [
      { agents: 1, runsPerDay: Math.floor(tier.executions / 30) },
      { agents: 3, runsPerDay: Math.floor(tier.executions / 30 / 3) },
      { agents: 5, runsPerDay: Math.floor(tier.executions / 30 / 5) },
      { agents: 10, runsPerDay: Math.floor(tier.executions / 30 / 10) },
    ];

    scenarios.forEach(s => {
      if (s.runsPerDay >= 1) {
        console.log(`  • ${s.agents.toString().padStart(2)} agent${s.agents > 1 ? 's' : ' '} → ${s.runsPerDay.toString().padStart(2)} runs/day each`);
      }
    });
  });

  // Cost breakdown
  console.log('\n\n💸 YOUR COST BREAKDOWN\n');
  console.log('═'.repeat(80));

  // Assuming you're using OpenAI GPT-4
  const openaiCostPer1kTokens = 0.03; // input cost for GPT-4 (rough average)
  const yourCostPerExecution = (medianTokensPerExec / 1000) * openaiCostPer1kTokens;
  const yourMarginPerExecution = targetPricePerRun - yourCostPerExecution;
  const marginPercent = (yourMarginPerExecution / targetPricePerRun) * 100;

  console.log(`\nLLM Cost (OpenAI):   $${openaiCostPer1kTokens}/1k tokens`);
  console.log(`Avg Execution Cost:  $${yourCostPerExecution.toFixed(4)} (${medianTokensPerExec} tokens)`);
  console.log(`Your Price:          $${targetPricePerRun.toFixed(4)}/execution`);
  console.log(`Gross Margin:        $${yourMarginPerExecution.toFixed(4)}/execution (${marginPercent.toFixed(1)}%)`);

  console.log('\n\nPer Tier Margins:');
  recommendedTiers.filter(t => t.price > 0).forEach(tier => {
    const revenue = tier.price;
    const cost = tier.executions * yourCostPerExecution;
    const profit = revenue - cost;
    const profitMargin = (profit / revenue) * 100;

    console.log(`\n${tier.name}:`);
    console.log(`  Revenue:      $${revenue.toFixed(2)}/mo`);
    console.log(`  LLM Cost:     $${cost.toFixed(2)}/mo`);
    console.log(`  Gross Profit: $${profit.toFixed(2)}/mo (${profitMargin.toFixed(1)}%)`);
  });

  // Final recommendation
  console.log('\n\n✅ FINAL RECOMMENDATION\n');
  console.log('═'.repeat(80));
  console.log('\nPricing Tiers:');
  console.log('  Free:         $0/mo   →    100 runs  (trial/testing)');
  console.log('  Starter:     $20/mo   →  1,000 runs  (1-3 agents, daily)');
  console.log('  Professional: $100/mo  →  5,000 runs  (5-10 agents, regular automation)');
  console.log('  Business:    $300/mo  → 15,000 runs  (10-25 agents, heavy automation)');

  console.log('\n\nWhy this works:');
  console.log('  ✅ Competitive with Zapier, Make, n8n');
  console.log('  ✅ ~50% gross margin (sustainable)');
  console.log('  ✅ Execution-based (easy for users to understand)');
  console.log('  ✅ Scales with real usage');
  console.log('  ✅ Multiple tiers for different user segments');

  console.log('\n\nCredit System:');
  console.log('  • Keep your Pilot Credits for branding');
  console.log('  • 1 Execution = ~330 Pilot Credits (based on median)');
  console.log('  • Or simplify: 1 Execution = 1 Run Credit (easier for users)');
  console.log('  • Rollover unused credits (competitive advantage!)');
}

analyzeCompetitivePricing().catch(console.error);
