/**
 * Build a v6-regression scenario from a saved agent.
 *
 * Pulls the agent's user_prompt (EP), pilot_steps, input_schema, and
 * agent_config.creation_metadata, then writes the canonical scenario files
 * (enhanced-prompt.json, phase4-pilot-dsl-steps.json) into the target folder.
 *
 * Does NOT create scenario.json or intent-contract.json — those are authored
 * separately (intent-contract isn't stored on the agent row and scenario.json
 * is hand-written metadata).
 *
 * Usage (run from project root):
 *   npx tsx tests/v6-regression/scripts/build-scenario-from-agent.ts <agent_id> <scenario_folder_name>
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

// __dirname = tests/v6-regression/scripts → repo root is three levels up
config({ path: resolve(__dirname, '../../../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const [agentId, scenarioName] = process.argv.slice(2);
if (!agentId || !scenarioName) {
  console.error('Usage: tsx tests/v6-regression/scripts/build-scenario-from-agent.ts <agent_id> <scenario_folder_name>');
  process.exit(1);
}

(async () => {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, agent_name, user_prompt, pilot_steps, input_schema, agent_config, ai_reasoning, created_at')
    .eq('id', agentId)
    .single();
  if (error) { console.error('read failed:', error); process.exit(1); }

  const scenarioDir = resolve(__dirname, '..', 'scenarios', scenarioName);
  console.log('Writing scenario files to:', scenarioDir);

  // 1. enhanced-prompt.json — parse the EP JSON string stored on user_prompt
  let ep: any;
  try {
    ep = JSON.parse(agent.user_prompt);
  } catch (e) {
    console.error('user_prompt is not parseable JSON; writing as raw string');
    ep = { raw: agent.user_prompt };
  }
  writeFileSync(`${scenarioDir}/enhanced-prompt.json`, JSON.stringify(ep, null, 2));

  // 2. phase4-pilot-dsl-steps.json — the agent's compiled DSL
  writeFileSync(`${scenarioDir}/phase4-pilot-dsl-steps.json`, JSON.stringify(agent.pilot_steps, null, 2));

  // 3. phase4-workflow-config.json — input_schema + reasoning notes
  const workflowConfig = {
    input_schema: agent.input_schema,
    creation_metadata: {
      agent_id: agent.id,
      agent_name: agent.agent_name,
      created_at: agent.created_at,
      ai_reasoning: agent.ai_reasoning,
      thread_id: agent.agent_config?.creation_metadata?.thread_id,
      session_id: agent.agent_config?.creation_metadata?.session_id,
      pipeline: agent.agent_config?.creation_metadata?.platform_version,
    },
  };
  writeFileSync(`${scenarioDir}/phase4-workflow-config.json`, JSON.stringify(workflowConfig, null, 2));

  console.log('✅ Wrote:');
  console.log('   - enhanced-prompt.json');
  console.log('   - phase4-pilot-dsl-steps.json');
  console.log('   - phase4-workflow-config.json');
  console.log('\nNot generated (write by hand):');
  console.log('   - scenario.json (metadata)');
  console.log('   - intent-contract.json (Phase 1 IR — not stored on agent row; capture via re-run)');
})();
