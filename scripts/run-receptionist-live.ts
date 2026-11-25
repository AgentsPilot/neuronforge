/**
 * One real run of the receptionist, on this working tree's code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `test-live-agent-execution.ts`
 *
 * That harness takes its inputs from `agent_configurations.input_values`, which
 * does not contain `scan_after` — that value is computed by `planInputs` at run
 * time from the agent's own `last_run`. Running through it would leave
 * `{{input.scan_after}}` unresolved and send Gmail a bare `after:`.
 *
 * So this mirrors the SCHEDULED path instead, which is the one production uses:
 * read the agent, `inputsFor(agent)`, `pilot.execute(...)`. Same functions, same
 * order, same arguments.
 *
 * THE PLAN IS INJECTED IN MEMORY, NOT WRITTEN. The agent's `pilot_steps` column
 * still holds the previously-synced plan; in production `install.ts` pushes a
 * new one when the plan's content hash changes. Here the committed JSON is read
 * off disk and swapped in for this run only, so the working tree is what
 * executes and the agent row is left exactly as it was found.
 *
 * WHAT A RUN ACTUALLY DOES, because this is not a dry run:
 *   · reads the owner's real inbox (headers, then one body per known client)
 *   · may create real Gmail DRAFTS (never sends to a client)
 *   · may create real CRM contacts and activities for unknown senders
 *   · spends real tokens
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/run-receptionist-live.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from 'fs';
import path from 'path';
import { supabaseServer } from '@/lib/supabaseServer';
import { inputsFor } from '@/lib/execution/inputsFor';
import { WorkflowPilot } from '@/lib/pilot';

const AGENT_ID = process.env.RECEPTIONIST_AGENT_ID || '4eec16a0-1310-4363-9801-a078beeb550d';
const PLAN = 'lib/business-os/automations/agents/draftClientReplies.steps.json';

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(22)} ${String(value)}`);
}

async function main() {
  const { data: agent, error } = await supabaseServer
    .from('agents')
    .select('*')
    .eq('id', AGENT_ID)
    .single();

  if (error || !agent) throw new Error(`Could not read the agent: ${error?.message}`);

  console.log('\nAGENT');
  line('name', agent.agent_name);
  line('status', agent.status);
  line('last_run', agent.last_run);

  /* The working tree's plan, not the one last synced to the column. */
  const planFromDisk = JSON.parse(fs.readFileSync(path.resolve(PLAN), 'utf8'));

  const inputValues = await inputsFor(agent as never);

  /* Reach further back for a test run, so the reply path can be exercised on a
     message the live watermark has already moved past. Hours, e.g. HOURS_BACK=48. */
  if (process.env.HOURS_BACK) {
    const hours = Number(process.env.HOURS_BACK);
    (inputValues as Record<string, unknown>).scan_after =
      Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
    console.log(`\n  [override] scanning ${hours}h back instead of the watermark`);
  }
  console.log('\nINPUTS resolved by planInputs');
  for (const [k, v] of Object.entries(inputValues)) {
    line(k, k === 'scan_after' ? `${v}  (${new Date(Number(v) * 1000).toISOString()})` : v);
  }

  const pilotAgent = {
    id: agent.id,
    user_id: agent.user_id,
    agent_name: agent.agent_name,
    user_prompt: agent.user_prompt ?? '',
    pilot_steps: planFromDisk,
    workflow_steps: planFromDisk,
    plugins_required: agent.plugins_required ?? [],
    status: agent.status,
    created_at: agent.created_at,
    updated_at: agent.updated_at ?? undefined,
  };

  console.log('\nRUNNING — real inbox, real drafts, real tokens\n');
  const started = Date.now();

  const execution = await new WorkflowPilot(supabaseServer).execute(
    pilotAgent as never,
    agent.user_id,
    pilotAgent.user_prompt,
    inputValues,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'production'
  );

  const result = execution as { success?: boolean; executionId?: string };
  console.log('\nRESULT');
  line('success', result?.success);
  line('executionId', result?.executionId);
  line('took', `${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (result?.executionId) {
    const { data: steps } = await supabaseServer
      .from('workflow_step_executions')
      .select('step_id, status, selected_model, selected_tier, item_count, error_message')
      .eq('workflow_execution_id', result.executionId)
      .order('started_at', { ascending: true });

    console.log('\nSTEPS');
    (steps ?? []).forEach((s) =>
      console.log(
        `  ${String(s.step_id).padEnd(8)} ${String(s.status).padEnd(10)}` +
          ` items:${String(s.item_count ?? '-').padEnd(5)}` +
          ` ${s.selected_tier ? `${s.selected_tier}/${s.selected_model}` : ''}` +
          ` ${s.error_message ? `ERR ${String(s.error_message).slice(0, 90)}` : ''}`
      )
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAILED:', err?.message || err);
    process.exit(1);
  });
