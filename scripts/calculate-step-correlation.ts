import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  console.log('🔍 Analyzing correlation between plugins and execution steps...\n');

  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, connected_plugins')
    .not('connected_plugins', 'is', null);

  if (!agents) return;

  const dataPoints: Array<{ plugins: number; steps: number }> = [];

  for (const agent of agents) {
    const pluginCount = agent.connected_plugins?.length || 0;

    const { data: tokenData } = await supabase
      .from('token_usage')
      .select('activity_type')
      .eq('agent_id', agent.id)
      .eq('activity_type', 'agent_execution');

    const executionSteps = tokenData?.length || 0;

    if (executionSteps > 0) {
      dataPoints.push({ plugins: pluginCount, steps: executionSteps });
      console.log(`Agent: ${agent.agent_name}`);
      console.log(`  Plugins: ${pluginCount} → Steps: ${executionSteps}\n`);
    }
  }

  // Group by plugin count
  const groupedByPlugins: Record<number, number[]> = {};
  dataPoints.forEach(({ plugins, steps }) => {
    if (!groupedByPlugins[plugins]) groupedByPlugins[plugins] = [];
    groupedByPlugins[plugins].push(steps);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 AVERAGE STEPS BY PLUGIN COUNT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  Object.keys(groupedByPlugins)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .forEach((plugins) => {
      const steps = groupedByPlugins[parseInt(plugins)];
      const avg = steps.reduce((sum, s) => sum + s, 0) / steps.length;
      const min = Math.min(...steps);
      const max = Math.max(...steps);

      console.log(`  ${plugins} plugin(s):`);
      console.log(`    Average steps: ${avg.toFixed(1)}`);
      console.log(`    Range: ${min}-${max} steps`);
      console.log(`    Sample size: ${steps.length} agents\n`);
    });

  // Overall correlation
  const avgSteps = dataPoints.reduce((sum, d) => sum + d.steps, 0) / dataPoints.length;
  const avgPlugins = dataPoints.reduce((sum, d) => sum + d.plugins, 0) / dataPoints.length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📈 OVERALL STATISTICS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Average plugins per agent: ${avgPlugins.toFixed(1)}`);
  console.log(`  Average steps per execution: ${avgSteps.toFixed(1)}`);
  console.log(`  Total agents analyzed: ${dataPoints.length}`);

  // Proposed formula
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('💡 RECOMMENDED PRICING FORMULA');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('  Creation cost: 800 Pilot Credits (one-time per agent)');
  console.log('  ');
  console.log('  Execution cost per run:');
  console.log('    Step 1: Calculate base cost');
  console.log('      base = (250 + plugins×15 + 10) × AIS');
  console.log('  ');
  console.log('    Step 2: Estimate execution steps based on plugins:');
  console.log('      1 plugin  → 5 steps avg');
  console.log('      2 plugins → 5 steps avg');
  console.log('      3 plugins → 8 steps avg');
  console.log('  ');
  console.log('    Step 3: Calculate per-step cost');
  console.log('      cost_per_step = base × 1.3');
  console.log('      (1.3x multiplier accounts for context passing)');
  console.log('  ');
  console.log('    Step 4: Total execution cost');
  console.log('      execution_cost = cost_per_step × estimated_steps');
  console.log('  ');
  console.log('  Monthly cost (per agent):');
  console.log('    800 + (15 runs × execution_cost)');
})();
