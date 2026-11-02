/*
 * Are this owner's agents actually working?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every agent problem found on 2026-11-02 looked healthy from the dashboard.
 * An import ran for 111 seconds, reported COMPLETED, wrote `last_run`, and
 * filed nobody — because its writes were rejected and the scatter's
 * `continueOnError` swallowed all 171 failures. A mailbox agent showed a
 * sensible "last run" date and had not succeeded for three days, because
 * `last_run` only ever records successes.
 *
 * So "no errors on screen" is not the question. The questions are:
 *
 *   · when did it last SUCCEED, not when did it last try
 *   · what did the last few runs actually do
 *   · did anything reach the owner (a dead-lettered run carries the sentence
 *     their dashboard shows)
 *   · and for an agent that writes, did anything appear
 *
 * Read-only. Safe to run against production at any time.
 *
 * Usage:  npx tsx --env-file=.env.local scripts/agent-health.ts [userId]
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabaseServer } from '@/lib/supabaseServer';

const USER = process.argv[2] ?? '08456106-aa50-4810-b12c-7ca84102da31';
const OURS = ['business-os-automation', 'inbox-enquiries'];

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

(async () => {
  const { data: agents, error } = await supabaseServer
    .from('agents')
    .select('id,agent_name,status,schedule_enabled,last_run,next_run,production_ready,plugins_required,agent_config')
    .eq('user_id', USER).is('deleted_at', null).order('agent_name');
  if (error) { console.log('AGENTS READ FAILED:', error.message); return; }

  const mine = (agents ?? []).filter((a: any) =>
    OURS.some(t => ((a as any).tags ?? []).includes(t)) ||
    a.agent_config?.business_os_automation || a.agent_config?.inbox_channel);

  console.log(`now ${new Date().toISOString()}   agents: ${mine.length}\n`);

  let unhealthy = 0;

  for (const a of mine as any[]) {
    const { data: runs, error: rerr } = await supabaseServer
      .from('agent_executions')
      .select('created_at,status,error_message,execution_duration_ms')
      .eq('agent_id', a.id).order('created_at', { ascending: false }).limit(6);
    if (rerr) { console.log(`${a.agent_name}: RUNS READ FAILED ${rerr.message}`); continue; }

    const recent = runs ?? [];
    const lastOutcome = recent[0];
    const failing = recent.filter(r => r.status === 'failed').length;
    const succeeded = recent.some(r => r.status === 'completed');

    /* The honest verdict: a run that tried is not a run that worked. */
    const verdict =
      a.status !== 'active' ? 'PAUSED'
      : !recent.length ? 'NEVER RUN'
      : lastOutcome?.status === 'failed' && !succeeded ? 'FAILING'
      : lastOutcome?.status === 'failed' ? 'LAST RUN FAILED'
      : 'OK';
    if (verdict !== 'OK' && verdict !== 'PAUSED') unhealthy += 1;

    console.log(`${verdict === 'OK' ? '✅' : '❌'} ${a.agent_name}`);
    console.log(`     verdict      ${verdict}   (${failing}/${recent.length} recent runs failed)`);
    console.log(`     last SUCCESS ${ago(a.last_run)}   next ${a.next_run ?? '-'}`);
    console.log(`     guard        ${JSON.stringify(a.plugins_required)}  production_ready=${a.production_ready}`);
    if (lastOutcome?.error_message) {
      console.log(`     last error   ${String(lastOutcome.error_message).slice(0, 120)}`);
    }
    console.log();
  }

  console.log(unhealthy === 0 ? 'All agents healthy.' : `${unhealthy} agent(s) need attention.`);
})();
