// Calculate the actual step multiplier from real data

const agents = [
  { name: 'a27cf5db', plugins: 1, steps: 3, actualExecution: 925 },
  { name: '3ed35aa5', plugins: 2, steps: 4, actualExecution: 1644 },
  { name: '079c434d', plugins: 3, steps: 11, actualExecution: 5383 },
  { name: '49bc2e0d', plugins: 1, steps: 9, actualExecution: 2881 },
  { name: '30853d0a', plugins: 1, steps: 2, actualExecution: 402 },
  { name: '2ff2c133', plugins: 1, steps: 2, actualExecution: 364 }
];

const getAisScore = (plugins: number): number => {
  if (plugins <= 1) return 1.2;
  if (plugins === 2) return 1.6;
  if (plugins <= 4) return 2.2;
  return 2.8;
};

console.log('Calculating actual step multiplier from real data:\n');

const multipliers: number[] = [];

agents.forEach(agent => {
  const BASE = 250;
  const PLUGIN_OVERHEAD = 15;
  const SYS = 10;
  const aisScore = getAisScore(agent.plugins);

  const baseFormula = (BASE + (agent.plugins * PLUGIN_OVERHEAD) + SYS) * aisScore;
  const actualCostPerStep = agent.actualExecution / agent.steps;
  const multiplier = actualCostPerStep / baseFormula;

  multipliers.push(multiplier);

  console.log(`Agent ${agent.name}:`);
  console.log(`  Base formula: ${baseFormula.toFixed(0)} credits`);
  console.log(`  Actual: ${agent.actualExecution} credits / ${agent.steps} steps = ${actualCostPerStep.toFixed(0)} per step`);
  console.log(`  Multiplier: ${multiplier.toFixed(2)}x\n`);
});

const avgMultiplier = multipliers.reduce((sum, m) => sum + m, 0) / multipliers.length;
console.log(`Average multiplier: ${avgMultiplier.toFixed(2)}x`);
console.log(`Recommended: ${Math.round(avgMultiplier * 100) / 100}x`);
