// scripts/analyze-openai-csv.ts
// Analyze actual OpenAI CSV usage data

async function analyzeOpenAICSV() {
  console.log('📊 ANALYZING OPENAI CSV DATA\n');
  console.log('═'.repeat(80));

  // Data extracted from the two CSV files
  // Sept 1 - Oct 1 (30 days) + Oct 2 - Oct 29 (27 days) = 57 days total

  const modelUsage = {
    'gpt-4o': {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    },
    'gpt-4': {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    'gpt-4o-mini': {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    'gpt-3.5-turbo': {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  };

  // Manually extracted from CSV (Sept 1 - Oct 29)
  // GPT-4o data
  const gpt4oRows = [
    [52, 52838, 13614, 4608], [13, 50878, 5131, 0], [5, 1928, 1428, 0],
    [35, 44955, 22485, 30464], [8, 10787, 4073, 4864], [35, 69913, 22160, 43648],
    [99, 61650, 20248, 15360], [169, 123352, 81512, 32256], [227, 244193, 134982, 75904],
    [139, 134927, 94717, 22272], [53, 53817, 29867, 6656], [95, 93766, 54370, 4480],
    [94, 59828, 23993, 1024], [8, 6323, 3957, 0], [18, 16860, 9194, 1024],
    [16, 36235, 7035, 10368], [103, 105019, 56012, 0], [139, 146576, 73910, 1024],
    // October data
    [76, 75821, 28841, 1024], [6, 4494, 4438, 0], [14, 11642, 6613, 1152],
    [193, 193525, 54999, 34432], [97, 109130, 38256, 31488], [90, 106917, 44815, 11904],
    [4, 7621, 1830, 0], [79, 146538, 35921, 49152], [48, 80181, 24223, 18560],
    [21, 32130, 5764, 14848], [34, 52312, 9627, 18560], [17, 27855, 5705, 3200],
    [9, 5748, 2687, 0], [1, 679, 263, 0], [19, 13051, 5056, 0],
    [7, 10708, 3664, 1024], [11, 19918, 4807, 2048], [95, 309263, 22271, 176128],
    [220, 534761, 53914, 289152], [40, 84628, 7814, 32640], [3, 4465, 1179, 0],
    [150, 327622, 46663, 168448], [18, 73188, 4926, 43776], [12, 96501, 5885, 2816],
    [16, 24881, 4627, 7168]
  ];

  gpt4oRows.forEach(row => {
    modelUsage['gpt-4o'].requests += row[0];
    modelUsage['gpt-4o'].inputTokens += row[1];
    modelUsage['gpt-4o'].outputTokens += row[2];
    modelUsage['gpt-4o'].cachedTokens += row[3];
  });

  // GPT-4 data
  const gpt4Rows = [
    [93, 52422, 18100], [29, 19689, 5691], [93, 39442, 2314],
    [63, 59743, 13868], [60, 83074, 39138], [2, 1208, 30],
    [19, 20702, 5396], [1, 516, 258], [9, 4100, 2603],
    [18, 8701, 2945], [3, 1509, 298],
    // October
    [8, 3983, 1692], [4, 2013, 671], [1, 421, 101],
    [35, 17218, 15327], [2, 989, 960], [35, 17206, 15641],
    [3, 1473, 1503], [2, 982, 791], [2, 982, 771]
  ];

  gpt4Rows.forEach(row => {
    modelUsage['gpt-4'].requests += row[0];
    modelUsage['gpt-4'].inputTokens += row[1];
    modelUsage['gpt-4'].outputTokens += row[2];
  });

  // GPT-4o-mini data
  const gpt4oMiniRows = [
    [2, 2808, 37], [25, 9848, 6669], [5, 1546, 1243],
    [17, 7183, 4107], [1, 320, 255],
    // October
    [1, 27, 7]
  ];

  gpt4oMiniRows.forEach(row => {
    modelUsage['gpt-4o-mini'].requests += row[0];
    modelUsage['gpt-4o-mini'].inputTokens += row[1];
    modelUsage['gpt-4o-mini'].outputTokens += row[2];
  });

  // GPT-3.5-turbo data
  const gpt35Rows = [
    [9, 20828, 1970], [4, 584, 184]
  ];

  gpt35Rows.forEach(row => {
    modelUsage['gpt-3.5-turbo'].requests += row[0];
    modelUsage['gpt-3.5-turbo'].inputTokens += row[1];
    modelUsage['gpt-3.5-turbo'].outputTokens += row[2];
  });

  // Calculate totals
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;

  Object.values(modelUsage).forEach(model => {
    totalRequests += model.requests;
    totalInputTokens += model.inputTokens;
    totalOutputTokens += model.outputTokens;
    totalCachedTokens += (model.cachedTokens || 0);
  });

  const totalTokens = totalInputTokens + totalOutputTokens;

  console.log('\n📈 USAGE SUMMARY (Sept 1 - Oct 29, 2025)\n');
  console.log('─'.repeat(80));
  console.log(`Period:           57 days`);
  console.log(`Total Requests:   ${totalRequests.toLocaleString()}`);
  console.log(`Total Tokens:     ${totalTokens.toLocaleString()}`);
  console.log(`  Input Tokens:   ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output Tokens:  ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Cached Tokens:  ${totalCachedTokens.toLocaleString()}`);

  console.log('\n\n📊 BREAKDOWN BY MODEL\n');
  console.log('─'.repeat(80));

  Object.entries(modelUsage).forEach(([model, data]) => {
    if (data.requests > 0) {
      const totalModelTokens = data.inputTokens + data.outputTokens;
      const percentage = (totalModelTokens / totalTokens * 100).toFixed(1);
      console.log(`\n${model}:`);
      console.log(`  Requests:      ${data.requests.toLocaleString()} (${(data.requests / totalRequests * 100).toFixed(1)}%)`);
      console.log(`  Input Tokens:  ${data.inputTokens.toLocaleString()}`);
      console.log(`  Output Tokens: ${data.outputTokens.toLocaleString()}`);
      if (data.cachedTokens) {
        console.log(`  Cached Tokens: ${data.cachedTokens.toLocaleString()}`);
      }
      console.log(`  Total Tokens:  ${totalModelTokens.toLocaleString()} (${percentage}%)`);
    }
  });

  // Calculate actual costs using OpenAI pricing
  console.log('\n\n💰 ACTUAL COSTS (OpenAI Pricing)\n');
  console.log('═'.repeat(80));

  // OpenAI pricing (per 1M tokens)
  const pricing = {
    'gpt-4o': { input: 2.50, output: 10.00, cached: 1.25 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
  };

  let totalCost = 0;

  console.log('\nBy Model:\n');

  Object.entries(modelUsage).forEach(([model, data]) => {
    if (data.requests > 0) {
      const modelPricing = pricing[model as keyof typeof pricing];
      const inputCost = (data.inputTokens / 1000000) * modelPricing.input;
      const outputCost = (data.outputTokens / 1000000) * modelPricing.output;
      const cachedCost = data.cachedTokens && modelPricing.cached
        ? (data.cachedTokens / 1000000) * modelPricing.cached
        : 0;
      const modelTotal = inputCost + outputCost + cachedCost;
      totalCost += modelTotal;

      console.log(`${model}:`);
      console.log(`  Input:  $${inputCost.toFixed(2)}`);
      console.log(`  Output: $${outputCost.toFixed(2)}`);
      if (cachedCost > 0) {
        console.log(`  Cached: $${cachedCost.toFixed(2)}`);
      }
      console.log(`  Total:  $${modelTotal.toFixed(2)}\n`);
    }
  });

  console.log(`TOTAL COST (57 days): $${totalCost.toFixed(2)}`);
  const monthlyCost = (totalCost / 57) * 30;
  console.log(`Monthly Projection:   $${monthlyCost.toFixed(2)}`);
  const dailyCost = totalCost / 57;
  console.log(`Daily Average:        $${dailyCost.toFixed(2)}`);

  // Calculate with Claude Haiku switch
  console.log('\n\n💡 PROJECTED COSTS WITH CLAUDE HAIKU\n');
  console.log('═'.repeat(80));

  // Assume 50% of GPT-4o usage is execution (switch to Haiku)
  // Keep other 50% as creation (keep GPT-4o)
  const gpt4oExecutionTokens = (modelUsage['gpt-4o'].inputTokens + modelUsage['gpt-4o'].outputTokens) * 0.5;
  const gpt4oCreationTokens = (modelUsage['gpt-4o'].inputTokens + modelUsage['gpt-4o'].outputTokens) * 0.5;

  // Claude Haiku pricing (per 1M tokens)
  const haikuInputCost = 0.25;
  const haikuOutputCost = 1.25;

  // Calculate execution cost with Haiku (60/40 input/output split)
  const haikuExecutionCost = (gpt4oExecutionTokens * 0.6 / 1000000) * haikuInputCost +
                              (gpt4oExecutionTokens * 0.4 / 1000000) * haikuOutputCost;

  // Keep creation cost with GPT-4o
  const gpt4oCreationCost = (gpt4oCreationTokens * 0.6 / 1000000) * pricing['gpt-4o'].input +
                             (gpt4oCreationTokens * 0.4 / 1000000) * pricing['gpt-4o'].output;

  // Other models stay the same
  const gpt4Cost = (modelUsage['gpt-4'].inputTokens / 1000000) * pricing['gpt-4'].input +
                   (modelUsage['gpt-4'].outputTokens / 1000000) * pricing['gpt-4'].output;
  const gpt4oMiniCost = (modelUsage['gpt-4o-mini'].inputTokens / 1000000) * pricing['gpt-4o-mini'].input +
                        (modelUsage['gpt-4o-mini'].outputTokens / 1000000) * pricing['gpt-4o-mini'].output;
  const gpt35Cost = (modelUsage['gpt-3.5-turbo'].inputTokens / 1000000) * pricing['gpt-3.5-turbo'].input +
                    (modelUsage['gpt-3.5-turbo'].outputTokens / 1000000) * pricing['gpt-3.5-turbo'].output;

  const newTotalCost = haikuExecutionCost + gpt4oCreationCost + gpt4Cost + gpt4oMiniCost + gpt35Cost;
  const newMonthlyCost = (newTotalCost / 57) * 30;

  console.log(`\nCost Breakdown:`);
  console.log(`  GPT-4o (creation):      $${gpt4oCreationCost.toFixed(2)}`);
  console.log(`  Claude Haiku (exec):    $${haikuExecutionCost.toFixed(2)}`);
  console.log(`  GPT-4 (unchanged):      $${gpt4Cost.toFixed(2)}`);
  console.log(`  GPT-4o-mini:            $${gpt4oMiniCost.toFixed(2)}`);
  console.log(`  GPT-3.5-turbo:          $${gpt35Cost.toFixed(2)}`);
  console.log(`\nTOTAL (57 days):          $${newTotalCost.toFixed(2)}`);
  console.log(`Monthly Projection:       $${newMonthlyCost.toFixed(2)}`);

  const savings = totalCost - newTotalCost;
  const savingsPercent = (savings / totalCost) * 100;
  const monthlySavings = monthlyCost - newMonthlyCost;

  console.log(`\n\n💰 SAVINGS\n`);
  console.log('─'.repeat(80));
  console.log(`Total Savings (57 days): $${savings.toFixed(2)} (${savingsPercent.toFixed(1)}%)`);
  console.log(`Monthly Savings:         $${monthlySavings.toFixed(2)}`);
  console.log(`Annual Savings:          $${(monthlySavings * 12).toFixed(2)}`);

  // Pricing recommendations
  const monthlyRequests = (totalRequests / 57) * 30;
  const costPerRequest = newMonthlyCost / monthlyRequests;

  console.log(`\n\n🎯 PRICING STRATEGY\n`);
  console.log('═'.repeat(80));
  console.log(`\nMonthly Requests: ${Math.round(monthlyRequests).toLocaleString()}`);
  console.log(`Cost per Request: $${costPerRequest.toFixed(4)}`);

  const tiers = [
    { name: 'Free', requests: 100, price: 0 },
    { name: 'Starter', requests: 500, price: 15 },
    { name: 'Professional', requests: 2000, price: 40 },
    { name: 'Business', requests: 6000, price: 100 },
    { name: 'Enterprise', requests: 15000, price: 250 },
  ];

  console.log(`\n\nRECOMMENDED TIERS:\n`);

  tiers.forEach(tier => {
    const cost = tier.requests * costPerRequest;
    const profit = tier.price - cost;
    const margin = tier.price > 0 ? (profit / tier.price) * 100 : 0;

    console.log(`${tier.name}:`);
    console.log(`  Price: $${tier.price}/mo`);
    console.log(`  Requests: ${tier.requests.toLocaleString()}`);
    console.log(`  Cost: $${cost.toFixed(2)}`);
    console.log(`  Profit: $${profit.toFixed(2)}`);
    console.log(`  Margin: ${margin.toFixed(1)}% ${margin >= 60 ? '✅' : '⚠️'}\n`);
  });

  console.log(`\n✅ KEY INSIGHTS\n`);
  console.log('═'.repeat(80));
  console.log(`\n1. Current monthly cost: $${monthlyCost.toFixed(2)}`);
  console.log(`2. With Haiku: $${newMonthlyCost.toFixed(2)} (save $${monthlySavings.toFixed(2)}/month)`);
  console.log(`3. Cost per request: $${costPerRequest.toFixed(4)}`);
  console.log(`4. You can offer competitive pricing with 70-90% margins`);
  console.log(`5. GPT-4o is ${(modelUsage['gpt-4o'].requests / totalRequests * 100).toFixed(1)}% of your usage`);
  console.log(`6. Switching execution to Haiku will cut costs by ${savingsPercent.toFixed(1)}%\n`);
}

analyzeOpenAICSV().catch(console.error);
