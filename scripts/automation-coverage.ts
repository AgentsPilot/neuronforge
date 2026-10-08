/**
 * How much of the owner's work the platform is actually doing.
 *
 * WHY THIS IS A SCRIPT AND NOT A CARD
 *
 * On the reporting account the answer is 0.4%, and "we can automate 0.4% of
 * your work" is a demoralising thing to put on somebody's dashboard. It is also
 * not actionable BY THE OWNER: they cannot fix it, because the gap is missing
 * automations rather than switches left off.
 *
 * It is extremely actionable for whoever builds the product, which is who this
 * is for. The ranked uncovered list is the roadmap: the biggest number in it is
 * the next automation worth writing.
 *
 * Revisit the decision once coverage is high enough to be encouraging, or once
 * there is an automation the owner could switch on in response.
 *
 * USAGE
 *   npx tsx --env-file=.env.local scripts/automation-coverage.ts --user=<uuid>
 *   npx tsx --env-file=.env.local scripts/automation-coverage.ts --all --days=60
 */

import { createClient } from '@supabase/supabase-js';
import { AuditTrailRepository } from '@/lib/repositories/AuditTrailRepository';
import {
  automationCoverage,
  automatableNowPercent,
  type AutomationId,
} from '@/lib/business-os/insight/behaviour/automationCoverage';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase env. Run with: npx tsx --env-file=.env.local ...');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = process.argv.slice(2);
const ALL = args.includes('--all');
const ONE_USER = args.find(a => a.startsWith('--user='))?.slice('--user='.length);
const DAYS = Number(args.find(a => a.startsWith('--days='))?.slice('--days='.length) ?? 30);

/**
 * Which automations this owner has switched on.
 *
 * The column per automation is declared in `lib/business-os/gaps/automations.ts`;
 * they are repeated here rather than imported because that module pulls in the
 * gap registry and its repositories, which a reporting script has no reason to
 * load. If a fifth automation is added, this map needs the new column -- and the
 * coverage number silently under-reports until it does, which is the one way
 * this script can lie.
 */
const AUTOMATION_COLUMNS: Record<AutomationId, string> = {
  reply_to_enquiries: 'lead_autosend_enabled',
  chase_invoices: 'chase_invoices_enabled',
  chase_intake: 'chase_intake_enabled',
  remind_about_meeting: 'meeting_reminder_enabled',
  auto_complete_meetings: 'auto_complete_meetings_enabled',
};

async function enabledFor(userId: string): Promise<Set<AutomationId>> {
  const columns = Object.values(AUTOMATION_COLUMNS).join(', ');

  const { data, error } = await supabase
    .from('business_profiles')
    .select(columns)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Reported as "none on" would overstate the gap; say so instead of guessing.
    console.error(`    automation settings unreadable: ${error.message}`);
    return new Set();
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const on = new Set<AutomationId>();

  for (const [id, column] of Object.entries(AUTOMATION_COLUMNS) as [AutomationId, string][]) {
    if (row[column] === true) on.add(id);
  }

  return on;
}

async function reportFor(userId: string): Promise<void> {
  const repo = new AuditTrailRepository(supabase);
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: tallies, error }, enabled] = await Promise.all([
    repo.countOwnerActionsSince(userId, since),
    enabledFor(userId),
  ]);

  if (error || !tallies) {
    console.error(`  ${userId}: ${error?.message ?? 'no activity read'}`);
    return;
  }

  const report = automationCoverage(
    tallies.map(t => ({ action: t.action, count: t.count })),
    enabled
  );

  const percent = automatableNowPercent(report);

  console.log(`\n  ${userId}`);
  console.log(`    automations on   ${enabled.size ? [...enabled].join(', ') : 'none'}`);
  console.log(`    owner did        ${report.ownerActions} work actions`);
  console.log(`    an automation could take        ${report.automatable}`);
  console.log(
    `    ...and one is switched on for   ${report.automatableNow}` +
      (percent === null ? '   (nothing to measure)' : `   (${percent}%)`)
  );

  if (report.uncovered.length === 0) {
    console.log('    nothing uncovered');
    return;
  }

  console.log('\n    WHAT NOTHING CAN DO YET (ranked: the next automation to build)');
  for (const line of report.uncovered.slice(0, 12)) {
    console.log(`      ${String(line.count).padStart(4)}  ${line.action}`);
  }

  const tail = report.uncovered.slice(12).reduce((n, l) => n + l.count, 0);
  if (tail > 0) {
    // Named rather than dropped: a silent truncation reads as full coverage.
    console.log(`      ${String(tail).padStart(4)}  (${report.uncovered.length - 12} more kinds)`);
  }
}

async function main() {
  if (!ONE_USER && !ALL) {
    console.error('Pass --user=<uuid> or --all. Optional: --days=N (default 30).');
    process.exit(1);
  }

  let users: string[];
  if (ONE_USER) {
    users = [ONE_USER];
  } else {
    const [{ data: b }, { data: i }] = await Promise.all([
      supabase.from('scheduling_bookings').select('user_id'),
      supabase.from('payment_invoices').select('user_id'),
    ]);
    users = [...new Set([...(b ?? []), ...(i ?? [])].map(r => r.user_id).filter(Boolean))];
  }

  console.log(`Automation coverage over the last ${DAYS} days — ${users.length} account(s)`);

  for (const userId of users) {
    await reportFor(userId);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
