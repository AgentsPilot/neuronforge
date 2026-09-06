/**
 * What the Business OS chat cost, per question.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/chat-usage-report.ts
 *   ... --days=7          window (default 1)
 *   ... --user=<uuid>     one account (default: everyone)
 *
 * Read-only.
 *
 * Ordered by what you can act on. Cost per turn is the headline; hit rate and
 * repair rate are the two levers that move it; the prompt/completion split says
 * which end of the prompt to attack.
 */

import { getChatUsage, type ChatUsageReport } from '@/lib/business-os/bizql/telemetry/usageReport';

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

const money = (n: number | null) => (n === null ? '—' : `$${n.toFixed(6)}`);
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const line = (label: string, value: string, note = '') =>
  console.log(`  ${label.padEnd(22)} ${value.padStart(14)}${note ? `   ${note}` : ''}`);

function render(report: ChatUsageReport, days: number, scope: string) {
  const { cache } = report;

  console.log(`\nBusiness OS chat — last ${days} day${days === 1 ? '' : 's'}   (${scope})`);
  console.log('─'.repeat(64));

  if (report.turns === 0) {
    console.log('  No turns recorded in this window.');
    if (report.calls > 0) {
      console.log(
        `  ${report.calls} call(s) exist but carry no turn id — they predate the\n` +
          '  instrumentation, so cost per question cannot be computed for them.'
      );
    }
    return;
  }

  console.log('\n  WHAT A QUESTION COSTS');
  line('cost per turn', money(report.costPerTurnUsd));
  line('turns', String(report.turns), `${report.calls} model call(s)`);
  line('attributed spend', money(report.attributedCostUsd), 'what the turns above cost');
  if (report.totalCostUsd !== report.attributedCostUsd) {
    line('window total', money(report.totalCostUsd), 'incl. calls with no turn id');
  }

  console.log('\n  THE TWO LEVERS');
  line(
    'cache hit rate',
    pct(cache.hitRate),
    `${cache.exact} exact · ${cache.semantic} semantic · ${cache.miss} miss`
  );
  line('repair rate', pct(report.repairRate), `${report.repairs} turn(s) needed a second call`);

  console.log('\n  WHERE THE TOKENS ARE');
  line('prompt', report.promptTokens.toLocaleString(), pct(report.promptShare) + ' of all tokens');
  line('completion', report.completionTokens.toLocaleString());

  console.log('\n  HEALTH');
  line('median latency', `${report.medianLatencyMs ?? '—'} ms`);
  line('failures', String(report.failures));

  // Never let a partial window read as a complete one.
  if (report.turnsCovered < 1) {
    console.log(
      `\n  ⚠ Only ${pct(report.turnsCovered)} of rows in this window carry a turn id.\n` +
        '    The figures above cover that subset; the rest predate the instrumentation.'
    );
  }
  console.log();
}

async function main() {
  const days = Number(arg('days') ?? 1);
  const userId = arg('user');
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const report = await getChatUsage({ from, userId });
  render(report, days, userId ? `user ${userId.slice(0, 8)}` : 'all users');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
