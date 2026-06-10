/**
 * Build a Phase-E (live-run) scenario from a saved agent — AS IS.
 *
 * Captures the agent's EXACT current DB state — no LLM, no recompile, no new
 * IntentContract — into a folder that `scripts/test-live-agent-execution.ts`
 * can run live (file-based path), which also PERSISTS any edits you make to the
 * scenario files back onto the agent in the DB:
 *   - phase4-pilot-dsl-steps.json  → agents.pilot_steps / workflow_steps   (E5)
 *   - phase4-workflow-config.json  → agent_configurations.input_values     (E6)
 *
 * So: edit a file here → re-run the live script → the change is saved on the
 * agent and executed.
 *
 * Output folder: tests/v6-regression/scenarios/<slug>/  — a first-class
 * regression scenario. It carries NO intent-contract.json; instead scenario.json
 * sets `dsl_provided: true`, which tells run-regression.ts to skip Compile +
 * Phase A and run the committed DB DSL straight through Phase D (mocked).
 * Phase E (live) is run separately via test-live-agent-execution.ts.
 *
 * Files written:
 *   - enhanced-prompt.json          (agents.user_prompt, parsed)
 *   - phase4-pilot-dsl-steps.json   (agents.pilot_steps — exact DB DSL)
 *   - phase4-workflow-config.json   (agent_configurations.input_values — flat
 *                                    key→value map; the shape the live runner's
 *                                    --config / --input-dir expects)
 *   - scenario.json                 (metadata + the run command)
 *
 * Usage (run from project root):
 *   npx tsx tests/v6-regression/scripts/build-phase-e-scenario-from-agent.ts <agent_id> [<slug>]
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

// __dirname = tests/v6-regression/scripts → repo root is three levels up
config({ path: resolve(__dirname, '../../../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const [agentId, slugArg] = process.argv.slice(2);
if (!agentId) {
  console.error('Usage: tsx tests/v6-regression/scripts/build-phase-e-scenario-from-agent.ts <agent_id> [<slug>]');
  process.exit(1);
}

function w(dir: string, file: string, data: unknown) {
  writeFileSync(`${dir}/${file}`, JSON.stringify(data, null, 2));
  console.log('   wrote', file);
}

(async () => {
  // ── Agent row (exact DB state) ────────────────────────────────────────────
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, user_id, agent_name, user_prompt, pilot_steps, input_schema, plugins_required, agent_config, created_at')
    .eq('id', agentId)
    .single();
  if (error) { console.error('read failed:', error); process.exit(1); }

  if (!Array.isArray(agent.pilot_steps) || agent.pilot_steps.length === 0) {
    console.error('Agent has no pilot_steps in the DB — nothing to capture.');
    process.exit(1);
  }

  // ── Configured inputs (most-recent agent_configurations row) ──────────────
  const { data: cfgRows, error: cfgErr } = await supabase
    .from('agent_configurations')
    .select('input_values, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (cfgErr) { console.error('agent_configurations read failed:', cfgErr); process.exit(1); }

  const inputValues: Record<string, any> = cfgRows?.[0]?.input_values ?? {};
  if (!cfgRows?.length) {
    console.warn('⚠️  No agent_configurations row — phase4-workflow-config.json will be empty {}.');
    console.warn('    The live run will have no input values; fill them into the file before running.');
  }

  const slug = slugArg || agent.agent_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const dir = resolve(__dirname, '..', 'scenarios', slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  console.log(`Agent  : ${agent.agent_name} (${agent.id})`);
  console.log(`Owner  : ${agent.user_id}`);
  console.log(`DSL    : ${agent.pilot_steps.length} steps`);
  console.log(`Inputs : ${Object.keys(inputValues).join(', ') || '(none)'}`);
  console.log(`Folder : ${dir}\n`);

  // ── enhanced-prompt.json (reference) ──────────────────────────────────────
  let ep: any;
  try { ep = JSON.parse(agent.user_prompt); } catch { ep = { raw: agent.user_prompt }; }
  w(dir, 'enhanced-prompt.json', ep);

  // ── phase4-pilot-dsl-steps.json (exact DB DSL — the live runner reads this) ─
  w(dir, 'phase4-pilot-dsl-steps.json', agent.pilot_steps);

  // ── phase4-workflow-config.json (flat input_values map — live runner --config) ─
  w(dir, 'phase4-workflow-config.json', inputValues);

  // ── scenario.json (docs + run command) ────────────────────────────────────
  const stepTypes = Array.from(new Set(agent.pilot_steps.map((s: any) => s.type || s.step_type).filter(Boolean)));
  w(dir, 'scenario.json', {
    name: `${agent.agent_name} — exact DB DSL (Phase D mocked + Phase E live)`,
    description: `Captured AS IS from agent ${agent.id} (created ${agent.created_at}). Exact DB pilot_steps + configured input_values — no LLM, no recompile, no IntentContract. \`dsl_provided: true\` tells run-regression.ts to skip Compile + Phase A and run the committed DB DSL through Phase D (mocked). Phase E (live) runs via test-live-agent-execution.ts (file-based): the DSL is persisted to agents.pilot_steps and the config to agent_configurations.input_values before executing, so edits to these files are saved on the agent in the DB.`,
    created: agent.created_at?.slice(0, 10),
    dsl_provided: true,
    source: {
      type: 'live-agent-asis-capture',
      agent_id: agent.id,
      owner_user_id: agent.user_id,
      endpoint: 'tests/v6-regression/scripts/build-phase-e-scenario-from-agent.ts',
    },
    plugins: agent.plugins_required || [],
    expected: {
      min_steps: agent.pilot_steps.length,
      step_types: stepTypes,
      phase_d_success: true,
      phase_e_success: true,
    },
    run: {
      phase_d_note: 'Run as part of the suite: npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts',
      phase_e_note: 'Requires TEST_USER_ID in .env.local to equal the agent owner above. Live run reads real plugins and is outward-facing (sends real email).',
      phase_e_command: `npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts --agent-id ${agent.id} --input-dir tests/v6-regression/scenarios/${slug}`,
    },
  });

  console.log('\n✅ Phase-E scenario captured under scenarios/. Runs in the suite via Phase D (mocked).');
  console.log('   To run Phase E LIVE (persists files → DB, then executes):');
  console.log(`   npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \\`);
  console.log(`     --agent-id ${agent.id} \\`);
  console.log(`     --input-dir tests/v6-regression/scenarios/${slug}`);
  console.log('\n   ⚠️  Live + outward-facing: real plugin calls, real LLM, real email send, real DB writes.');
  process.exit(0);
})();
