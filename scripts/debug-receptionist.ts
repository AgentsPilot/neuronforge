/**
 * Run the receptionist for real, and show everything it decided.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Debugging this agent through the UI costs five minutes per attempt and tells
 * you almost nothing. "Run now" does not run anything — it sets `next_run` and
 * waits for a five-minute sweep. The execution row holds no logs until the run
 * finishes. `agent_logs` has no `execution_id` column, so there is no
 * step-level trace at all. And the one thing worth reading — the model's own
 * reason for the outcome it picked — is buried in a `crm_activities` row that
 * only exists for three of the five outcomes.
 *
 * So one evening of debugging became: press a button, wait, query four tables,
 * reason backwards from token counts. This does it in one command, now, with
 * the reason printed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS THE REAL AGENT, WITH REAL EFFECTS
 *
 * The same `WorkflowPilot.execute` call the scheduler makes, with
 * `runMode: 'production'`, against the real mailbox and the real database. It
 * can label threads, write drafts, raise cards and SEND a client a door. There
 * is no dry run, because a dry run would not tell you what the real one does.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/debug-receptionist.ts dotenv_config_path=.env.local
 *
 *   --since=30      only report activity from the last N minutes (default 30)
 *   --plan          print what plan is installed, and change nothing
 */

import { createClient } from '@supabase/supabase-js';
import { WorkflowPilot } from '@/lib/pilot';

const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';
const RECEPTIONIST = '4eec16a0-1310-4363-9801-a078beeb550d';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const arg = (name: string): string | undefined =>
  process.argv.find(a => a.startsWith(`--${name}`))?.split('=')[1] ?? undefined;

const flag = (name: string): boolean => process.argv.some(a => a === `--${name}`);

const line = (s = '') => console.log(s);
const rule = (t: string) => line(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);

type Row = Record<string, unknown>;

/** Walk the plan to the branch steps, which is where every decision lives. */
function decisionSteps(steps: Row[]): Record<string, Row> {
  const scatter = steps.find(s => s.type === 'scatter_gather') as Row | undefined;
  const inner = ((scatter?.scatter as Row)?.steps as Row[]) ?? [];
  const gate = inner.find(s => s.type === 'conditional') as Row | undefined;
  const seven = ((gate?.steps as Row[]) ?? []).find(s => s.id === 'step7c') as Row | undefined;
  return Object.fromEntries((((seven?.steps as Row[]) ?? [])).map(s => [s.id as string, s]));
}

async function showPlan(): Promise<void> {
  const { data } = await db
    .from('agents')
    .select('agent_config, pilot_steps, workflow_steps, last_run, next_run, status')
    .eq('id', RECEPTIONIST)
    .maybeSingle();

  const bos = ((data?.agent_config as Row)?.business_os_automation ?? {}) as Row;

  /*
   * THE PLAN THAT RUNS IS THE CATALOGUE'S, so that is what this reports. The
   * row's copy is printed beside it only to show the divergence: reading the
   * row and calling it "the plan that will run" is exactly the mistake that
   * made this script agree with a bug for an evening.
   */
  const { automationById: cat } = await import('@/lib/business-os/automations/catalog');
  const steps = ((cat(String(bos.id))?.steps ?? []) as unknown) as Row[];
  const rowCopy = JSON.stringify(data?.pilot_steps ?? null);
  const by = decisionSteps(steps);
  const s8 = by.step8 ?? {};
  const outcomes =
    (((s8.output_schema as Row)?.properties as Row)?.outcome as { enum?: string[] })?.enum ?? [];
  const doors =
    (((s8.output_schema as Row)?.properties as Row)?.door as { enum?: string[] })?.enum ?? [];
  const prompt = String(s8.prompt ?? '');

  rule('THE PLAN THAT WILL RUN  (from the working tree, not the database)');
  line(`  status        ${data?.status}`);
  line(`  planVersion   ${bos.planVersion}`);
  line(`  last_run      ${data?.last_run}`);
  line(`  branches      ${Object.keys(by).join(', ')}`);
  line(`  outcomes      ${outcomes.join(', ') || '(none)'}`);
  line(`  doors         ${doors.join(', ') || '(none)'}`);
  line('');
  /* The two rules that have fought each other all evening. If the door rule is
     missing, the run will escalate every refund and the prompt is stale. */
  line(`  door-is-not-answering   ${prompt.includes('SENDING A DOOR IS NOT ANSWERING')}`);
  /* Not "does it SAY read the doors first" — does `send_link` physically come
     before `needs_owner`. Saying it and not doing it is what escalated a mail
     whose body was the words "requesting a refund". */
  const doorsAt = prompt.indexOf("'send_link'");
  const ownerAt = prompt.indexOf("'needs_owner' — a question");
  line(`  doors listed first      ${doorsAt > -1 && doorsAt < ownerAt}   (send_link@${doorsAt}, needs_owner@${ownerAt})`);
  line(`  old swallow rule gone   ${!prompt.includes('would need any fact you were NOT given')}`);
  line('');
  /*
   * WHAT THE DATABASE HOLDS, AND WHO PUT IT THERE.
   *
   * Vercel's scheduled sweep rewrites this column from the last COMMITTED
   * catalogue on every run. While this feature is uncommitted, that copy is
   * the OLD four-outcome receptionist — and it is what any run triggered from
   * the UI will execute, on Vercel, whatever this laptop just wrote.
   *
   * This script does not use it. The line is here so the gap is visible
   * instead of mysterious.
   */
  line(`  the row's own copy has doors   ${rowCopy.includes('send_link')}`);
  if (!rowCopy.includes('send_link')) {
    line('');
    line("  ⚠  The DB copy is the pre-doors plan — Vercel's. \"Run now\" in the UI");
    line('     would execute THAT, not this. Only this script runs what you see.');
  }
}

async function runIt(): Promise<string | null> {
  const { data: agent } = await db.from('agents').select('*').eq('id', RECEPTIONIST).maybeSingle();
  if (!agent) {
    line('No such agent.');
    return null;
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE PLAN COMES FROM THE LOCAL CATALOGUE, NOT FROM `agents.pilot_steps`.
   *
   * This is the single most important line in the script, and it cost an
   * evening to learn.
   *
   * `pilot_steps` is a COPY of the catalogue plan, written by `refreshPlan`
   * from whatever code did the refreshing. Two machines refresh it: this
   * laptop, when the automations page is opened, and Vercel, on every
   * scheduled sweep. They do not run the same code — Vercel runs the last
   * COMMITTED catalogue, and this feature is not committed.
   *
   * So the row flipped between two plans all evening. A page load wrote the
   * five-outcome plan with doors; the next cron sweep wrote the old
   * four-outcome one back and ran THAT. Every escalation I was debugging was
   * the model answering a question with no `send_link` in it — correctly.
   * `--plan` read the good copy seconds before the run used the bad one.
   *
   * Reading the catalogue directly removes the race entirely: the plan that
   * runs is the plan in the working tree, which is the plan being tested.
   * Nothing is written back, so the cron can keep overwriting that column
   * without touching this run.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { automationById: catalogueFor } = await import(
    '@/lib/business-os/automations/catalog'
  );
  const bosId = String(
    ((agent.agent_config as Row)?.business_os_automation as Row)?.id ?? ''
  );
  const localPlan = (catalogueFor(bosId)?.steps ?? null) as Row[] | null;
  if (!localPlan) {
    line(`The catalogue has no automation '${bosId}'. Nothing to run.`);
    return null;
  }

  /*
   * The inputs the scheduler computes. Recomputed here rather than imported,
   * because `inputsFor` is private to the runner — and the window is the thing
   * most likely to explain a run that found nothing, so it is printed.
   */
  const { planInputs } = await import('@/lib/business-os/automations/install');
  const { automationById } = await import('@/lib/business-os/automations/catalog');
  const bos = ((agent.agent_config as Row)?.business_os_automation ?? {}) as Row;
  const automation = automationById(String(bos.id));
  const inputValues = automation
    ? planInputs(automation, agent.agent_config as Row, agent.last_run as string | null)
    : {};

  rule('WINDOW');
  for (const [k, v] of Object.entries(inputValues)) line(`  ${k.padEnd(18)} ${v}`);
  if ('scan_after' in inputValues) {
    line('');
    line('  Anything the client sent BEFORE that is invisible to this run.');
  }

  rule('RUNNING — this is the real agent, with real effects');
  const started = Date.now();

  const pilot = new WorkflowPilot(db);
  const execution = await pilot.execute(
    {
      id: agent.id,
      user_id: agent.user_id,
      agent_name: agent.agent_name,
      user_prompt: agent.user_prompt ?? '',
      /* The local catalogue's plan — see the comment above. Both fields, so
         no fallback can reach the row's stale copy. */
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
    inputValues as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'production'
  );

  const seconds = Math.round((Date.now() - started) / 1000);
  const ok = (execution as { success?: boolean })?.success;
  const executionId = (execution as { executionId?: string })?.executionId ?? null;

  line(`\n  finished in ${seconds}s   success=${ok}   execution ${executionId}`);
  /* The pilot reports failure by RETURNING, not by throwing — see the comment
     in scheduledAgentRunner. A thrown error is a crash; this is a failed plan. */
  if (ok === false) line('  the plan FAILED — read the step output below, not the activity');

  return executionId;
}

async function showWhatItDid(sinceMinutes: number, executionId: string | null): Promise<void> {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  if (executionId) {
    const { data: m } = await db
      .from('execution_metrics')
      .select('total_items, items_by_field')
      .eq('execution_id', executionId)
      .maybeSingle();
    if (m) {
      const f = (m.items_by_field ?? {}) as Row;
      rule('WHAT IT SAW');
      line(`  emails scanned          ${m.total_items}`);
      line(`  from known clients      ${f.has_rows ?? '-'}   (the rest go to the stranger branch)`);
    }
  }

  /*
   * THE DECISION, IN THE MODEL'S OWN WORDS.
   *
   * `description` is written as the client's quote, a blank line, then the
   * model's reason. The reason is the single most useful line in this script:
   * it says WHY an outcome was chosen, which no other record holds.
   */
  rule('WHAT IT DECIDED');
  const { data: acts } = await db
    .from('crm_activities')
    .select('created_at, activity_type, title, description, source_thread_id, draft_body')
    .eq('user_id', OWNER)
    .gte('created_at', since)
    .order('created_at');

  if (!acts?.length) {
    line('  Nothing written.');
    line('');
    line('  That is not the same as nothing happening. It means every message');
    line('  either chose `ignore`, was stopped by the draft guard at step7c, or');
    line('  never passed the "have we written to this sender" gate at step5.');
  }

  for (const a of (acts ?? []) as Row[]) {
    const kind = String(a.activity_type);
    const flagged =
      kind === 'reply_needs_owner'
        ? '  ← A CARD. The owner was interrupted.'
        : kind === 'portal_door_sent'
          ? '  ← A DOOR WENT OUT.'
          : '';
    line(`\n  ${String(a.created_at).slice(11, 19)}  ${kind}${flagged}`);
    line(`     subject  ${String(a.title ?? '')}`);
    line(`     thread   ${a.source_thread_id ?? '-'}`);

    /* The split the receptionist writes: the client's words, then its reason. */
    const described = String(a.description ?? '');
    const [quote, ...rest] = described.split(/\n\s*\n/);
    const reason = rest.join('\n\n').trim();
    if (reason) {
      line(`     client   "${quote.replace(/\s+/g, ' ').slice(0, 150)}"`);
      line(`     REASON   ${reason.replace(/\s+/g, ' ').slice(0, 400)}`);
    } else if (described) {
      line(`     body     ${described.replace(/\s+/g, ' ').slice(0, 250)}`);
    }
    if (a.draft_body) line(`     draft    ${String(a.draft_body).replace(/\s+/g, ' ').slice(0, 140)}`);
  }

  rule('WHAT IT SENT');
  const { data: sends } = await db
    .from('email_sends')
    .select('created_at, to_email, email_kind, subject')
    .eq('user_id', OWNER)
    .gte('created_at', since)
    .order('created_at');

  if (!sends?.length) line('  Nothing sent.');
  for (const e of (sends ?? []) as Row[]) {
    const door = String(e.email_kind) === 'self_service_link' ? '  ← THE DOOR' : '';
    line(`  ${String(e.created_at).slice(11, 19)}  → ${e.to_email}  [${e.email_kind}]${door}`);
    line(`     ${String(e.subject ?? '')}`);
  }

  rule('AND THE REFUND SIDE');
  const { data: reqs } = await db
    .from('refund_requests')
    .select('created_at, status, amount_requested, currency, reason, recommendation, reasoning')
    .eq('user_id', OWNER)
    .order('created_at', { ascending: false })
    .limit(3);
  if (!reqs?.length) line('  No refund requests yet — the client has not filled the form.');
  for (const r of (reqs ?? []) as Row[]) {
    line(`  ${String(r.created_at).slice(0, 19)}  ${r.status}  ${r.amount_requested} ${r.currency}  ${r.reason ?? ''}`);
    if (r.recommendation) line(`     agent says: ${r.recommendation} — ${String(r.reasoning ?? '').slice(0, 160)}`);
  }
  line('');
}

async function main(): Promise<void> {
  const sinceMinutes = Number(arg('since') ?? 30);

  await showPlan();
  if (flag('plan')) {
    line('\n(--plan given: nothing was run)\n');
    return;
  }

  const executionId = await runIt();
  await showWhatItDid(sinceMinutes, executionId);
}

main().catch(err => {
  console.error('\nThe harness itself failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
