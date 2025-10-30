// scripts/analyze-intelligent-routing-savings.ts
// Calculate cost savings from intelligent model routing based on AIS scores

async function analyzeIntelligentRoutingSavings() {
  console.log('🎯 INTELLIGENT MODEL ROUTING - COST ANALYSIS\n');
  console.log('═'.repeat(80));

  // Your actual production data (from CSV analysis)
  const productionData = {
    totalRequests: 3134,
    totalInputTokens: 4046941,
    totalOutputTokens: 1226046,
    totalTokens: 5272987,
    avgTokensPerRequest: 1682,
    gpt4oRequests: 2588,  // 82.6%
    gpt4Requests: 482,    // 15.4%
    period: 57, // days
  };

  // Model pricing (per 1M tokens)
  const pricing = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'claude-haiku': { input: 0.25, output: 1.25 },
    'gpt-4': { input: 30.00, output: 60.00 },
  };

  // Current cost calculation
  const currentGpt4oCost = (
    (productionData.gpt4oRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (productionData.gpt4oRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  const currentGpt4Cost = (
    (productionData.gpt4Requests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4'].input +
    (productionData.gpt4Requests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4'].output
  );

  const currentTotalCost = currentGpt4oCost + currentGpt4Cost;
  const currentMonthlyCost = (currentTotalCost / productionData.period) * 30;

  console.log('\n💰 CURRENT COSTS (No Intelligent Routing)\n');
  console.log('─'.repeat(80));
  console.log(`GPT-4o:  ${productionData.gpt4oRequests} requests → $${currentGpt4oCost.toFixed(2)}`);
  console.log(`GPT-4:   ${productionData.gpt4Requests} requests → $${currentGpt4Cost.toFixed(2)}`);
  console.log(`TOTAL:   $${currentTotalCost.toFixed(2)} (${productionData.period} days)`);
  console.log(`Monthly: $${currentMonthlyCost.toFixed(2)}`);

  // SCENARIO 1: Intelligent Routing with AIS Scores
  console.log('\n\n🎯 SCENARIO 1: AIS-Based Intelligent Routing\n');
  console.log('═'.repeat(80));

  // Assume intensity distribution (you'll get real data from your DB)
  // Based on typical distributions: low=30%, medium=50%, high=20%
  const intensityDistribution = {
    low: 0.30,      // Score 0-3
    medium: 0.50,   // Score 3-6
    high: 0.20,     // Score 6-10
  };

  console.log('\nAssumed Agent Distribution by Intensity:');
  console.log(`  Low (0-3):    ${(intensityDistribution.low * 100).toFixed(0)}% → Route to gpt-4o-mini`);
  console.log(`  Medium (3-6): ${(intensityDistribution.medium * 100).toFixed(0)}% → Route to gpt-4o`);
  console.log(`  High (6-10):  ${(intensityDistribution.high * 100).toFixed(0)}% → Route to gpt-4o`);

  // Route GPT-4o requests based on intensity
  const lowIntensityRequests = productionData.gpt4oRequests * intensityDistribution.low;
  const mediumIntensityRequests = productionData.gpt4oRequests * intensityDistribution.medium;
  const highIntensityRequests = productionData.gpt4oRequests * intensityDistribution.high;

  // Calculate costs with routing
  const lowIntensityCost = (
    (lowIntensityRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o-mini'].input +
    (lowIntensityRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o-mini'].output
  );

  const mediumIntensityCost = (
    (mediumIntensityRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (mediumIntensityRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  const highIntensityCost = (
    (highIntensityRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (highIntensityRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  // Also upgrade GPT-4 to GPT-4o (recommended)
  const upgradedGpt4Cost = (
    (productionData.gpt4Requests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (productionData.gpt4Requests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  const scenario1Total = lowIntensityCost + mediumIntensityCost + highIntensityCost + upgradedGpt4Cost;
  const scenario1Monthly = (scenario1Total / productionData.period) * 30;

  console.log('\n\nCost Breakdown:');
  console.log(`  Low intensity (gpt-4o-mini):  ${lowIntensityRequests.toFixed(0)} requests → $${lowIntensityCost.toFixed(2)}`);
  console.log(`  Medium intensity (gpt-4o):    ${mediumIntensityRequests.toFixed(0)} requests → $${mediumIntensityCost.toFixed(2)}`);
  console.log(`  High intensity (gpt-4o):      ${highIntensityRequests.toFixed(0)} requests → $${highIntensityCost.toFixed(2)}`);
  console.log(`  GPT-4 → GPT-4o upgrade:       ${productionData.gpt4Requests} requests → $${upgradedGpt4Cost.toFixed(2)}`);
  console.log(`\nTOTAL: $${scenario1Total.toFixed(2)} (${productionData.period} days)`);
  console.log(`Monthly: $${scenario1Monthly.toFixed(2)}`);

  const scenario1Savings = currentTotalCost - scenario1Total;
  const scenario1SavingsPercent = (scenario1Savings / currentTotalCost) * 100;
  const scenario1MonthlySavings = currentMonthlyCost - scenario1Monthly;

  console.log(`\n💰 SAVINGS: $${scenario1Savings.toFixed(2)} (${scenario1SavingsPercent.toFixed(1)}%)`);
  console.log(`   Monthly: $${scenario1MonthlySavings.toFixed(2)}`);
  console.log(`   Annual:  $${(scenario1MonthlySavings * 12).toFixed(2)}`);

  // SCENARIO 2: Aggressive Routing (more to mini)
  console.log('\n\n🎯 SCENARIO 2: Aggressive Routing (50% to mini)\n');
  console.log('═'.repeat(80));

  const aggressiveDistribution = {
    low: 0.50,      // 50% to mini
    medium: 0.30,   // 30% stay on 4o
    high: 0.20,     // 20% stay on 4o
  };

  console.log('\nAgent Distribution:');
  console.log(`  Low (0-4):    ${(aggressiveDistribution.low * 100).toFixed(0)}% → gpt-4o-mini`);
  console.log(`  Medium (4-7): ${(aggressiveDistribution.medium * 100).toFixed(0)}% → gpt-4o`);
  console.log(`  High (7-10):  ${(aggressiveDistribution.high * 100).toFixed(0)}% → gpt-4o`);

  const aggLowRequests = productionData.gpt4oRequests * aggressiveDistribution.low;
  const aggMedRequests = productionData.gpt4oRequests * aggressiveDistribution.medium;
  const aggHighRequests = productionData.gpt4oRequests * aggressiveDistribution.high;

  const aggLowCost = (
    (aggLowRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o-mini'].input +
    (aggLowRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o-mini'].output
  );

  const aggMedCost = (
    (aggMedRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (aggMedRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  const aggHighCost = (
    (aggHighRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['gpt-4o'].input +
    (aggHighRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['gpt-4o'].output
  );

  const scenario2Total = aggLowCost + aggMedCost + aggHighCost + upgradedGpt4Cost;
  const scenario2Monthly = (scenario2Total / productionData.period) * 30;

  console.log('\nCost Breakdown:');
  console.log(`  Low (gpt-4o-mini):   ${aggLowRequests.toFixed(0)} requests → $${aggLowCost.toFixed(2)}`);
  console.log(`  Medium (gpt-4o):     ${aggMedRequests.toFixed(0)} requests → $${aggMedCost.toFixed(2)}`);
  console.log(`  High (gpt-4o):       ${aggHighRequests.toFixed(0)} requests → $${aggHighCost.toFixed(2)}`);
  console.log(`  GPT-4 → GPT-4o:      ${productionData.gpt4Requests} requests → $${upgradedGpt4Cost.toFixed(2)}`);
  console.log(`\nTOTAL: $${scenario2Total.toFixed(2)}`);
  console.log(`Monthly: $${scenario2Monthly.toFixed(2)}`);

  const scenario2Savings = currentTotalCost - scenario2Total;
  const scenario2SavingsPercent = (scenario2Savings / currentTotalCost) * 100;
  const scenario2MonthlySavings = currentMonthlyCost - scenario2Monthly;

  console.log(`\n💰 SAVINGS: $${scenario2Savings.toFixed(2)} (${scenario2SavingsPercent.toFixed(1)}%)`);
  console.log(`   Monthly: $${scenario2MonthlySavings.toFixed(2)}`);
  console.log(`   Annual:  $${(scenario2MonthlySavings * 12).toFixed(2)}`);

  // SCENARIO 3: With Claude Haiku for medium intensity
  console.log('\n\n🎯 SCENARIO 3: Multi-Model Strategy (Mini + Haiku + GPT-4o)\n');
  console.log('═'.repeat(80));

  console.log('\nRouting Strategy:');
  console.log(`  Low (0-3):    30% → gpt-4o-mini`);
  console.log(`  Medium (3-6): 50% → claude-haiku`);
  console.log(`  High (6-10):  20% → gpt-4o`);

  const haikuRequests = productionData.gpt4oRequests * 0.50;
  const haikuCost = (
    (haikuRequests * productionData.avgTokensPerRequest * 0.6 / 1000000) * pricing['claude-haiku'].input +
    (haikuRequests * productionData.avgTokensPerRequest * 0.4 / 1000000) * pricing['claude-haiku'].output
  );

  const scenario3Total = lowIntensityCost + haikuCost + highIntensityCost + upgradedGpt4Cost;
  const scenario3Monthly = (scenario3Total / productionData.period) * 30;

  console.log('\nCost Breakdown:');
  console.log(`  Low (gpt-4o-mini):    ${lowIntensityRequests.toFixed(0)} requests → $${lowIntensityCost.toFixed(2)}`);
  console.log(`  Medium (claude-haiku): ${haikuRequests.toFixed(0)} requests → $${haikuCost.toFixed(2)}`);
  console.log(`  High (gpt-4o):        ${highIntensityRequests.toFixed(0)} requests → $${highIntensityCost.toFixed(2)}`);
  console.log(`  GPT-4 → GPT-4o:       ${productionData.gpt4Requests} requests → $${upgradedGpt4Cost.toFixed(2)}`);
  console.log(`\nTOTAL: $${scenario3Total.toFixed(2)}`);
  console.log(`Monthly: $${scenario3Monthly.toFixed(2)}`);

  const scenario3Savings = currentTotalCost - scenario3Total;
  const scenario3SavingsPercent = (scenario3Savings / currentTotalCost) * 100;
  const scenario3MonthlySavings = currentMonthlyCost - scenario3Monthly;

  console.log(`\n💰 SAVINGS: $${scenario3Savings.toFixed(2)} (${scenario3SavingsPercent.toFixed(1)}%)`);
  console.log(`   Monthly: $${scenario3MonthlySavings.toFixed(2)}`);
  console.log(`   Annual:  $${(scenario3MonthlySavings * 12).toFixed(2)}`);

  // Summary comparison
  console.log('\n\n📊 SCENARIO COMPARISON\n');
  console.log('═'.repeat(80));

  console.log('\n| Scenario | Monthly Cost | Monthly Savings | Savings % |');
  console.log('|----------|--------------|-----------------|-----------|');
  console.log(`| Current (no routing) | $${currentMonthlyCost.toFixed(2)} | $0.00 | 0% |`);
  console.log(`| Scenario 1 (30/50/20) | $${scenario1Monthly.toFixed(2)} | $${scenario1MonthlySavings.toFixed(2)} | ${scenario1SavingsPercent.toFixed(1)}% |`);
  console.log(`| Scenario 2 (50/30/20) | $${scenario2Monthly.toFixed(2)} | $${scenario2MonthlySavings.toFixed(2)} | ${scenario2SavingsPercent.toFixed(1)}% |`);
  console.log(`| Scenario 3 (Haiku mix) | $${scenario3Monthly.toFixed(2)} | $${scenario3MonthlySavings.toFixed(2)} | ${scenario3SavingsPercent.toFixed(1)}% |`);

  // Updated pricing with savings
  console.log('\n\n💰 IMPACT ON YOUR PRICING\n');
  console.log('═'.repeat(80));

  const newCostPerRequest = scenario1Monthly / ((productionData.totalRequests / productionData.period) * 30);

  console.log(`\nNew cost per request: $${newCostPerRequest.toFixed(4)} (was $${(currentMonthlyCost / ((productionData.totalRequests / productionData.period) * 30)).toFixed(4)})`);

  const tiers = [
    { name: 'Starter', price: 15, requests: 500 },
    { name: 'Professional', price: 40, requests: 2000 },
    { name: 'Business', price: 100, requests: 6000 },
  ];

  console.log('\n\nPricing Tiers with Intelligent Routing:\n');
  tiers.forEach(tier => {
    const cost = tier.requests * newCostPerRequest;
    const profit = tier.price - cost;
    const margin = (profit / tier.price) * 100;

    console.log(`${tier.name}:`);
    console.log(`  Price: $${tier.price}/mo`);
    console.log(`  Requests: ${tier.requests.toLocaleString()}`);
    console.log(`  Cost: $${cost.toFixed(2)}`);
    console.log(`  Profit: $${profit.toFixed(2)}`);
    console.log(`  Margin: ${margin.toFixed(1)}% ${margin >= 70 ? '✅' : margin >= 50 ? '⚠️' : '❌'}\n`);
  });

  console.log('\n✅ KEY TAKEAWAYS\n');
  console.log('═'.repeat(80));
  console.log(`\n1. Intelligent routing can save ${scenario1SavingsPercent.toFixed(1)}% on LLM costs`);
  console.log(`2. Monthly savings: $${scenario1MonthlySavings.toFixed(2)} (Annual: $${(scenario1MonthlySavings * 12).toFixed(2)})`);
  console.log(`3. Your margins improve by ${(scenario1MonthlySavings / currentMonthlyCost * 100).toFixed(1)} percentage points`);
  console.log(`4. Cost per request drops from $${(currentMonthlyCost / ((productionData.totalRequests / productionData.period) * 30)).toFixed(4)} to $${newCostPerRequest.toFixed(4)}`);
  console.log(`5. You can now afford competitive pricing with healthy margins\n`);
}

analyzeIntelligentRoutingSavings().catch(console.error);
