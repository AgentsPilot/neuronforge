import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

// Test the new pricing formula against real agent data

const getAisScore = (plugins: number): number => {
  if (plugins <= 1) return 1.2;
  if (plugins === 2) return 1.6;
  if (plugins <= 4) return 2.2;
  if (plugins <= 6) return 2.8;
  if (plugins <= 8) return 3.5;
  return 4.0;
};

const getEstimatedSteps = (plugins: number): number => {
  if (plugins === 1) return 4;
  if (plugins === 2) return 7;
  if (plugins <= 4) return 11;
  if (plugins <= 6) return 14;
  if (plugins <= 8) return 17;
  return 20;
};

const calculateNewFormula = (plugins: number): { creation: number; execution: number; total: number } => {
  const BASE = 250;
  const PLUGIN_OVERHEAD = 15;
  const SYS = 10;
  const CREATION_COST = 800;
  const STEP_MULTIPLIER = 1.3;

  const aisScore = getAisScore(plugins);
  const estimatedSteps = getEstimatedSteps(plugins);

  // Step 1: Base cost per step
  const basePerStep = (BASE + (plugins * PLUGIN_OVERHEAD) + SYS) * aisScore;

  // Step 2: Apply step multiplier
  const costPerStep = basePerStep * STEP_MULTIPLIER;

  // Step 3: Total execution cost
  const executionCost = Math.round(costPerStep * estimatedSteps);

  return {
    creation: CREATION_COST,
    execution: executionCost,
    total: CREATION_COST + executionCost
  };
};

console.log('═══════════════════════════════════════════════════════════════════');
console.log('🧪 NEW PRICING FORMULA VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════════\n');

console.log('Formula:');
console.log('  Creation: 800 credits (one-time)');
console.log('  Execution: ((BASE + plugins×15 + 10) × AIS × 1.3) × estimated_steps');
console.log('  Total: creation + execution\n');

console.log('───────────────────────────────────────────────────────────────────\n');

// Test Case 1: Agent a27cf5db (1 plugin, 3 steps actual)
console.log('Test Case 1: Email Summary and Delivery Agent (a27cf5db)');
console.log('  Plugins: 1');
console.log('  Actual steps: 3');
console.log('  Actual costs:');
console.log('    Creation: 806 credits');
console.log('    Execution: 925 credits');
console.log('    Total: 1,730 credits\n');

const test1 = calculateNewFormula(1);
console.log('  Predicted costs:');
console.log(`    Creation: ${test1.creation} credits`);
console.log(`    Execution: ${test1.execution} credits`);
console.log(`    Total: ${test1.total} credits`);
console.log(`  Accuracy: ${((test1.total / 1730) * 100).toFixed(1)}%\n`);

console.log('───────────────────────────────────────────────────────────────────\n');

// Test Case 2: Agent 3ed35aa5 (2 plugins, 4 steps actual)
console.log('Test Case 2: Email Summary and Notification Agent (3ed35aa5)');
console.log('  Plugins: 2');
console.log('  Actual steps: 4');
console.log('  Actual costs:');
console.log('    Creation: 799 credits');
console.log('    Execution: 1,644 credits');
console.log('    Total: 2,443 credits\n');

const test2 = calculateNewFormula(2);
console.log('  Predicted costs:');
console.log(`    Creation: ${test2.creation} credits`);
console.log(`    Execution: ${test2.execution} credits`);
console.log(`    Total: ${test2.total} credits`);
console.log(`  Accuracy: ${((test2.total / 2443) * 100).toFixed(1)}%\n`);

console.log('───────────────────────────────────────────────────────────────────\n');

// Test Case 3: Agent 079c434d (3 plugins, 11 steps actual)
console.log('Test Case 3: Aptos Retail Blog Researcher (079c434d)');
console.log('  Plugins: 3');
console.log('  Actual steps: 11');
console.log('  Actual costs:');
console.log('    Creation: 845 credits');
console.log('    Execution: 5,383 credits');
console.log('    Total: 6,228 credits\n');

const test3 = calculateNewFormula(3);
console.log('  Predicted costs:');
console.log(`    Creation: ${test3.creation} credits`);
console.log(`    Execution: ${test3.execution} credits`);
console.log(`    Total: ${test3.total} credits`);
console.log(`  Accuracy: ${((test3.total / 6228) * 100).toFixed(1)}%\n`);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('📊 PRICING CALCULATOR EXAMPLE');
console.log('═══════════════════════════════════════════════════════════════════\n');

console.log('Example: 5 agents, 3 plugins each, 15 runs/month\n');

const example = calculateNewFormula(3);
const RUNS_PER_MONTH = 15;
const AGENTS = 5;

const creationCostTotal = example.creation * AGENTS;
const executionCostPerRun = example.execution;
const executionCostMonthly = executionCostPerRun * RUNS_PER_MONTH * AGENTS;
const totalMonthly = creationCostTotal + executionCostMonthly;
const monthlyCost = totalMonthly * 0.00048;

console.log('Breakdown:');
console.log(`  Creation (5 agents × 1 time): ${AGENTS} × ${example.creation} = ${creationCostTotal} credits`);
console.log(`  Execution per run: ${executionCostPerRun} credits`);
console.log(`  Monthly executions: ${RUNS_PER_MONTH} runs × 5 agents = ${RUNS_PER_MONTH * AGENTS} total runs`);
console.log(`  Monthly execution cost: ${executionCostMonthly} credits`);
console.log(`  ─────────────────────────────────────────────`);
console.log(`  Total monthly: ${totalMonthly} credits`);
console.log(`  Monthly cost: $${monthlyCost.toFixed(2)}`);
console.log(`\n  Daily Pilot Credits: ${Math.round(executionCostPerRun * (RUNS_PER_MONTH * AGENTS / 30))} credits/day`);
