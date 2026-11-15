/**
 * Run the refund agent for real, and show what it recommended.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME TWO LESSONS AS `debug-receptionist.ts`, SO READ THAT HEADER TOO.
 *
 * The plan comes from the LOCAL CATALOGUE, never from `agents.pilot_steps` —
 * that column is a copy, rewritten by whichever machine last refreshed it, and
 * the deployed code and this working tree do not agree while the feature is
 * uncommitted. And "Run now" in the UI does not run anything: it sets
 * `next_run` and waits for a sweep that executes somewhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS THE REAL AGENT. IT CANNOT MOVE MONEY.
 *
 * `WorkflowPilot.execute` with `runMode: 'production'`, against the real
 * database. It writes a recommendation and flips the request to
 * `awaiting_owner`, which is what makes the owner's card appear. It cannot
 * issue the refund it recommends: `transactions.refund` is `movesMoney`, and
 * `executeMutate` refuses that outright on any agent path.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/debug-refund-agent.ts dotenv_config_path=.env.local
 *
 *   --reset    put the newest request back to `submitted` first, so it can be
 *              claimed again. For re-running a test on one request.
 *   --plan     show the plan and the queue, and run nothing.
 */

import { createClient } from '@supabase/supabase-js';
import { WorkflowPilot } from '@/lib/pilot';

const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const flag = (n: string) => process.argv.some(a => a === `--${n}`);
const line = (s = '') => console.log(s);
const rule = (t: string) => line(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);

type Row = Record<string, unknown>;

const FIELDS =
  'id, created_at, status, amount_requested, currency, reason, note, booking_id, ' +
  'contact_id, source, recommendation, recommended_amount, reasoning, ' +
  'client_message_draft, transaction_id, assessed_at';

function showRequest(r: Row, indent = '  '): void {
  line(`${indent}${String(r.id).slice(0, 8)}  ${r.status}`);
  line(`${indent}  asked        ${r.amount_requested} ${r.currency}   (${r.reason ?? 'no reason given'})`);
  if (r.note) line(`${indent}  they wrote   "${String(r.note).replace(/\s+/g, ' ').slice(0, 120)}"`);
  line(`${indent}  booking      ${r.booking_id ?? '— none, which the agent must say out loud'}`);
  if (r.recommendation) {
    line(`${indent}  RECOMMENDS   ${r.recommendation}${r.recommended_amount ? `  ${r.recommended_amount} ${r.currency}` : ''}`);
    line(`${indent}  because      ${String(r.reasoning ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
    if (r.client_message_draft)
      line(`${indent}  draft reply  "${String(r.client_message_draft).replace(/\s+/g, ' ').slice(0, 200)}"`);
    line(`${indent}  assessed_at  ${r.assessed_at}`);
  } else {
    line(`${indent}  RECOMMENDS   — nothing yet`);
  }
}

async function newest(): Promise<Row[]> {
  const { data } = await db
    .from('refund_requests')
    .select(FIELDS)
    .eq('user_id', OWNER)
    .order('created_at', { ascending: false })
    .limit(3);
  return (data ?? []) as Row[];
}

async function main(): Promise<void> {
  const { data: agent } = await db
    .from('agents')
    .select('*')
    .eq('user_id', OWNER)
    .eq('status', 'active')
    .filter('agent_config->business_os_automation->>id', 'eq', 'assess_refund_requests')
    .maybeSingle();

  if (!agent) {
    line('The refund agent is not installed, or is paused. Nothing to run.');
    return;
  }

  const { automationById } = await import('@/lib/business-os/automations/catalog');
  const automation = automationById('assess_refund_requests');
  const localPlan = (automation?.steps ?? null) as Row[] | null;
  if (!localPlan) {
    line('The catalogue has no `assess_refund_requests`.');
    return;
  }

  rule('THE PLAN THAT WILL RUN  (from the working tree, not the database)');
  line(`  agent        ${String(agent.id).slice(0, 8)}   status ${agent.status}   last_run ${agent.last_run ?? 'never'}`);
  line(`  essential    ${automation?.essential === true}   (installs itself; the owner may pause it)`);
  line(`  steps        ${localPlan.map(s => s.id ?? s.step_id).join(' → ')}`);
  /* The gate that makes this agent safe to run unattended. */
  const flat = JSON.stringify(localPlan);
  line(`  writes only  ${(flat.match(/"action":"(\w+)"/g) ?? []).join(', ')}`);
  line(`  can refund   ${flat.includes('refund_transactions')}   (must be false — movesMoney is refused on agent paths)`);

  if (flag('reset')) {
    const rows = await newest();
    const target = rows[0];
    if (target && target.status !== 'submitted') {
      /*
       * Only ever back to `submitted`, and only the newest. Never onto a
       * terminal row: `refunded` / `declined` / `handled` mean a person
       * already answered, and re-opening that would ask them twice about
       * money they have already returned.
       */
      if (['refunded', 'declined', 'handled'].includes(String(target.status))) {
        line(`\n  --reset refused: ${target.status} is a person's answer, not a state to undo.`);
      } else {
        await db
          .from('refund_requests')
          .update({ status: 'submitted', recommendation: null, recommended_amount: null, reasoning: null, client_message_draft: null, assessed_at: null })
          .eq('id', target.id as string)
          .eq('user_id', OWNER);
        line(`\n  --reset: ${String(target.id).slice(0, 8)} ${target.status} → submitted`);
      }
    }
  }

  rule('THE QUEUE, BEFORE');
  const before = await newest();
  if (!before.length) line('  No refund requests at all. Submit the form first.');
  for (const r of before) showRequest(r);
  const claimable = before.filter(r => r.status === 'submitted').length;
  line(`\n  claimable (status='submitted'): ${claimable}`);
  if (!claimable) line('  → the agent will find nothing. Use --reset, or submit a new request.');

  if (flag('plan')) {
    line('\n(--plan given: nothing was run)\n');
    return;
  }

  rule('RUNNING — the real agent, writing to the real database');
  const started = Date.now();
  const pilot = new WorkflowPilot(db);
  const execution = await pilot.execute(
    {
      id: agent.id,
      user_id: agent.user_id,
      agent_name: agent.agent_name,
      user_prompt: agent.user_prompt ?? '',
      pilot_steps: localPlan,
      workflow_steps: localPlan,
      input_schema: agent.input_schema,
      output_schema: agent.output_schema,
      connected_plugins: agent.connected_plugins,
      created_at: agent.created_at,
      updated_at: agent.updated_at ?? undefined,
    } as never,
    agent.user_id as string,
    (agent.user_prompt as string) ?? '',
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'production'
  );

  const ok = (execution as { success?: boolean })?.success;
  line(`\n  finished in ${Math.round((Date.now() - started) / 1000)}s   success=${ok}   execution ${(execution as { executionId?: string })?.executionId}`);
  if (ok === false) line('  the plan FAILED — the pilot reports that by returning, not throwing');

  rule('THE QUEUE, AFTER');
  for (const r of await newest()) showRequest(r);

  rule("AND WHAT THE OWNER NOW SEES");
  /*
   * The card is not a table — it is `refundRequested.find()` deciding. Asking
   * the gap directly is the only honest check: a row in the right status that
   * the gap filters out for some other reason would otherwise look like a pass.
   */
  const { GAP_DEFINITIONS } = await import('@/lib/business-os/gaps/definitions');
  const def = (GAP_DEFINITIONS as unknown as Row[]).find(d => d.id === 'refund_requested');
  if (!def) {
    line('  `refund_requested` is not in GAP_DEFINITIONS — no card can ever render.');
    return;
  }
  const items = (await (def.find as (u: string, n: Date, c: unknown) => Promise<Row[]>)(
    OWNER,
    new Date(),
    { byGap: {} }
  )) as Row[];
  line(`  cards the refund gap raises: ${items.length}`);
  /*
   * EVERY FIELD THAT IS SET, RATHER THAN A CHOSEN FEW.
   *
   * This printed `title` and `detail` at first — names a `GapItem` does not
   * use. They came back empty, which read as "the card is missing its text"
   * and was reported as a defect. It was the harness looking in the wrong
   * place. Dumping what is actually there cannot make that mistake, and shows
   * a genuinely absent field as absent.
   */
  for (const i of items) {
    line('');
    for (const [k, v] of Object.entries(i)) {
      if (v === undefined || v === null || v === '') continue;
      const shown = typeof v === 'object' ? JSON.stringify(v) : String(v);
      line(`  ${k.padEnd(22)} ${shown.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
    if (!i.refundRecommendation)
      line('  ⚠ no refundRecommendation — the card would show an empty panel');
  }
  line();
}

main().catch(err => {
  console.error('\nThe harness itself failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
