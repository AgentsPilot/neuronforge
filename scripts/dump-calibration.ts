/**
 * dump-calibration.ts — pull a single agent's calibration evidence for RCA.
 *
 * Companion to dump-agent.ts (which dumps the workflow/DSL). This one dumps the
 * *calibration outcome*: the latest calibration_sessions row (live issues), the
 * calibration_history row (recorded outcome), and recent agent_executions — then
 * prints an RCA-oriented summary that highlights the EARLIEST failing step (the
 * rest are usually cascade) and classifies each issue.
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/dump-calibration.ts <agent_id>
 *   # or, mirroring dump-agent.ts:
 *   npx tsx scripts/dump-calibration.ts <agent_id>
 *
 * See docs/Calibration/CALIBRATION_RCA_RUNBOOK.md for how to read the output.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: tsx scripts/dump-calibration.ts <agent_id>');
  process.exit(1);
}

/** Parse an issues array that may be JSON, a string, or already-parsed. */
function asArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** One-line summary of a single issue object. */
function summarizeIssue(issue: any): string {
  const sev = issue?.severity ?? '?';
  const cat = issue?.category ?? issue?.type ?? '?';
  const step = issue?.affectedSteps?.[0]?.stepId ?? issue?.details?.failedStepIds?.join(',') ?? '-';
  const msg = (issue?.message ?? issue?.description ?? issue?.technicalDetails ?? '').toString().replace(/\s+/g, ' ').slice(0, 200);
  const fix = issue?.suggestedFix?.action?.problematicValue !== undefined
    ? ` | suggestedFix(${issue.suggestedFix.action.parameterName}=${JSON.stringify(issue.suggestedFix.action.problematicValue)}, conf=${issue.suggestedFix.confidence})`
    : '';
  return `  [${sev}/${cat}] step=${step} :: ${msg}${fix}`;
}

(async () => {
  // --- calibration_sessions: live state of the most recent run(s) ---
  const { data: sessions, error: sErr } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`\n================ calibration_sessions (${sessions?.length ?? 0})${sErr ? ' ERR: ' + sErr.message : ''} ================`);
  for (const row of sessions ?? []) {
    console.log(`\n• session ${row.id} | status=${row.status} | ${row.created_at}`);
    console.log(`  steps: completed=${row.completed_steps} failed=${row.failed_steps} skipped=${row.skipped_steps} total=${row.total_steps}`);
    console.log(`  issue_summary: ${JSON.stringify(row.issue_summary)}`);
    if (row.execution_summary) console.log(`  execution_summary: ${JSON.stringify(row.execution_summary).slice(0, 600)}`);
    const issues = asArray(row.issues);
    console.log(`  issues (${issues.length}):`);
    for (const i of issues) console.log(summarizeIssue(i));
  }

  // --- calibration_history: recorded outcome of completed run(s) ---
  const { data: history, error: hErr } = await supabase
    .from('calibration_history')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`\n================ calibration_history (${history?.length ?? 0})${hErr ? ' ERR: ' + hErr.message : ''} ================`);
  for (const row of history ?? []) {
    console.log(`\n• history ${row.id} | status=${row.status} | ${row.created_at}`);
    console.log(`  iterations=${row.iterations} auto_fixes_applied=${row.auto_fixes_applied} first_execution_success=${row.first_execution_success} marked_production_ready=${row.marked_production_ready}`);
    console.log(`  steps: completed=${row.steps_completed} failed=${row.steps_failed} skipped=${row.steps_skipped}`);
    console.log(`  plugins_used: ${JSON.stringify(row.plugins_used)} | workflow_hash=${(row.workflow_hash ?? '').slice(0, 12)}`);
    const remaining = asArray(row.issues_remaining);
    console.log(`  issues_remaining (${remaining.length}):`);
    for (const i of remaining) console.log(summarizeIssue(i));
  }

  // --- agent_executions: the underlying runs (incl. the dry-run) ---
  const { data: execs, error: eErr } = await supabase
    .from('agent_executions')
    .select('id, status, error_message, created_at, run_mode')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(6);

  console.log(`\n================ agent_executions (${execs?.length ?? 0})${eErr ? ' ERR: ' + eErr.message : ''} ================`);
  for (const r of execs ?? []) {
    console.log(`  ${r.created_at} | ${r.run_mode ?? '-'} | ${r.status} | ${(r.error_message ?? '').toString().replace(/\s+/g, ' ').slice(0, 300)}`);
  }

  // --- RCA hint: the earliest failing step (the rest are usually cascade) ---
  const latest = sessions?.[0] ?? history?.[0];
  if (latest) {
    const issues = asArray(latest.issues ?? latest.issues_remaining);
    const failedIds = new Set<string>();
    for (const i of issues) {
      (i?.details?.failedStepIds ?? []).forEach((s: string) => failedIds.add(s));
      const s = i?.affectedSteps?.[0]?.stepId;
      if (s) failedIds.add(s);
    }
    const sorted = [...failedIds].sort();
    console.log(`\n================ RCA HINT ================`);
    console.log(`  failing steps: ${sorted.join(', ') || '(none recorded)'}`);
    console.log(`  earliest failing step (likely root, rest may cascade): ${sorted[0] ?? '(none)'}`);
    console.log(`  → Next: open that step in pilot_steps (dump-agent.ts ${agentId}) and classify the layer`);
    console.log(`    (input/data vs V6 generation vs runtime/API vs calibration-detection).`);
    console.log(`  See docs/Calibration/CALIBRATION_RCA_RUNBOOK.md.`);
  }
})();
