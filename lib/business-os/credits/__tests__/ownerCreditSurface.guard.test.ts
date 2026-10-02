/**
 * The owner credit surface, by its source (credit deduction slice 6a,
 * workplan §4.6, §4.8, §7; FR-36, AC-33, SA Q-11).
 *
 *   1. FR-36 — retired: no agent-platform rate key, no `token_usage` and no
 *      "Pilot" anywhere in the owner route, the card, the signal module or any
 *      new 6a module. FULL source, comments included, so the old header text
 *      cannot survive either.
 *   2. AC-33 — no timers and no background channel in the card or the signal
 *      module: the card re-reads on a trigger, never on a clock.
 *   3. Q-11 — the two client-safe files in this server directory stay
 *      client-safe, and the card imports nothing else from it.
 *   4. Service role — the route and the payload builder hold no service-role
 *      client; it is confined to the wiring file's repositories.
 *
 * Slice 7a (workplan §4.11, SA condition 3) extends every rule to the credit
 * history: its route, builder, cursor, types and panel. And a new rule: no
 * client file may import the server modules behind the labels.
 *
 * Every rule is proved on a planted violation first: a rule that cannot match
 * reads exactly like a rule that found nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ROUTE = 'app/api/business-os/usage/route.ts';
const CARD = 'components/business-os/UsageCard.tsx';
const SIGNAL = 'lib/business-os/client/creditUsageSignal.ts';
const DISPLAY = 'lib/business-os/credits/creditDisplay.ts';
const TYPES = 'lib/business-os/credits/ownerCreditUsageTypes.ts';
const BUILDER = 'lib/business-os/credits/ownerCreditUsage.ts';
const DEPS = 'lib/business-os/credits/ownerCreditUsageDeps.ts';
// Slice 7a — the credit history.
const HISTORY_ROUTE = 'app/api/business-os/credits/history/route.ts';
const HISTORY_BUILDER = 'lib/business-os/credits/ownerCreditHistory.ts';
const HISTORY_CURSOR = 'lib/business-os/credits/creditHistoryCursor.ts';
const HISTORY_TYPES = 'lib/business-os/credits/creditHistoryTypes.ts';
const HISTORY_PANEL = 'components/business-os/CreditHistoryPanel.tsx';

const OWNER_SURFACE = [
  ROUTE,
  CARD,
  SIGNAL,
  BUILDER,
  DEPS,
  TYPES,
  DISPLAY,
  'lib/business-os/credits/creditPeriod.ts',
  'lib/business-os/credits/creditBalance.ts',
  'lib/business-os/entitlements/creditAllowanceView.ts',
  'lib/repositories/BusinessOsCreditOwnerReadRepository.ts',
  'lib/repositories/BusinessOsCreditPeriodRepository.ts',
  HISTORY_ROUTE,
  HISTORY_BUILDER,
  HISTORY_CURSOR,
  HISTORY_TYPES,
  HISTORY_PANEL,
  'lib/business-os/credits/effectiveFields.ts',
  'lib/business-os/credits/creditHistoryFlag.ts',
];

describe('1. FR-36: the agent-platform measure is retired from the owner surface', () => {
  const RETIRED = /monthly_ai_allowance_usd|pilot_credit_cost_usd|tokens_per_pilot_credit|token_usage|Pilot/;

  it('the rule matches planted violations', () => {
    for (const sample of [
      "getSystemConfigs(['monthly_ai_allowance_usd'])",
      "'pilot_credit_cost_usd'",
      "readConfig('tokens_per_pilot_credit')",
      ".from('token_usage')",
      ' * Pilot Credits remaining this month.',
    ]) {
      expect({ sample, matched: RETIRED.test(sample) }).toEqual({ sample, matched: true });
    }
  });

  it.each(OWNER_SURFACE)('%s names none of them (comments included)', (file) => {
    expect(read(file)).not.toMatch(RETIRED);
  });
});

describe('2. AC-33: no timers, no background channel', () => {
  const TIMER = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|BroadcastChannel)\b/;

  it('the rule matches planted violations', () => {
    for (const sample of ['setTimeout(read, 60000)', 'setInterval(poll, 1000)', 'requestAnimationFrame(tick)', 'new BroadcastChannel("x")']) {
      expect(TIMER.test(sample)).toBe(true);
    }
    expect(TIMER.test('clearTimeoutish')).toBe(false);
  });

  it.each([CARD, SIGNAL, HISTORY_PANEL])('%s uses none', (file) => {
    expect(codeOf(read(file))).not.toMatch(TIMER);
  });

  it('the history panel never listens for the card\'s refresh signal: it reads on open and on "Show more" only', () => {
    const SIGNAL_USE = /onCreditUsageChanged|creditUsageSignal|CREDIT_USAGE_CHANGED_EVENT/;
    expect(SIGNAL_USE.test("import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';")).toBe(true);
    expect(codeOf(read(HISTORY_PANEL))).not.toMatch(SIGNAL_USE);
  });
});

describe('3. Q-11: the client-safe files stay client-safe', () => {
  const IMPORT = /^\s*import\s/m;
  const VALUE_IMPORT = /^\s*import\s+(?!type\b)/m;

  it('the rules match planted imports', () => {
    expect(IMPORT.test("import { x } from 'y';")).toBe(true);
    expect(VALUE_IMPORT.test("import { x } from 'y';")).toBe(true);
    expect(VALUE_IMPORT.test("import type { x } from 'y';")).toBe(false);
  });

  it('creditDisplay.ts imports nothing', () => {
    expect(codeOf(read(DISPLAY))).not.toMatch(IMPORT);
  });

  it('ownerCreditUsageTypes.ts has no value import', () => {
    expect(codeOf(read(TYPES))).not.toMatch(VALUE_IMPORT);
  });

  it('creditHistoryTypes.ts imports nothing at all (SA C-S7-1: not even a type from the entitlements module)', () => {
    expect(codeOf(read(HISTORY_TYPES))).not.toMatch(IMPORT);
  });

  it('the history panel imports only creditDisplay and creditHistoryTypes from the credits directory, and no server module', () => {
    const code = codeOf(read(HISTORY_PANEL));
    const fromCredits = [...code.matchAll(/from\s+['"]@\/lib\/business-os\/credits\/([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(fromCredits).toEqual(['creditDisplay', 'creditHistoryTypes']);
    expect(code).not.toMatch(
      /@\/lib\/repositories|supabaseServer|business-os\/entitlements|server-only|llm\/aiActionAudit|effectiveFields|callCatalog|ownerCreditHistory/
    );
  });

  it('the card imports only those two from the credits directory, and no server module', () => {
    const code = codeOf(read(CARD));
    const fromCredits = [...code.matchAll(/from\s+['"]@\/lib\/business-os\/credits\/([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(fromCredits).toEqual(['creditDisplay', 'ownerCreditUsageTypes']);
    expect(code).not.toMatch(/@\/lib\/repositories|supabaseServer|business-os\/entitlements|server-only/);
  });
});

describe('4. the service role stays in the wiring file', () => {
  it.each([ROUTE, BUILDER, HISTORY_ROUTE, HISTORY_BUILDER])('%s imports no service-role client and no repository singleton', (file) => {
    const code = codeOf(read(file));
    expect(code).not.toMatch(/supabaseServer['"]/);
    expect(code).not.toMatch(/import\s+\{[^}]*\bbusinessOs\w+Repository\b[^}]*\}/);
  });

  it.each([ROUTE, HISTORY_ROUTE, HISTORY_BUILDER, HISTORY_CURSOR, HISTORY_TYPES, HISTORY_PANEL])(
    '%s imports nothing from the entitlements module (SA C-S7-1)',
    (file) => {
      expect(codeOf(read(file))).not.toMatch(/business-os\/entitlements/);
    }
  );

  it.each([HISTORY_BUILDER, 'lib/business-os/credits/effectiveFields.ts'])('%s is server-only', (file) => {
    expect(codeOf(read(file))).toMatch(/^import 'server-only';$/m);
  });

  it('the payload builder never calls check() or decide() — it is display only, never a gate', () => {
    const code = codeOf(read(BUILDER));
    expect(code).not.toMatch(/\.check\s*\(|\bdecide\s*\(/);
    expect(code).toMatch(/\.getSnapshot\(\s*accountId\s*\)/);
  });
});

describe('5. no client file imports the server modules behind the labels (slice 7a, SA SQ-33, F7-10)', () => {
  const SERVER_ONLY_MODULES = /from\s+['"][^'"]*(llm\/aiActionAudit|credits\/effectiveFields|llm\/callCatalog|credits\/ownerCreditHistory)['"]/;

  function clientFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...clientFiles(rel));
      else if (/\.tsx?$/.test(entry.name) && /^\s*['"]use client['"]/.test(read(rel))) out.push(rel);
    }
    return out;
  }

  it('the rule matches planted imports', () => {
    expect(SERVER_ONLY_MODULES.test("import { AI_ACTION_DECLARATIONS } from '@/lib/business-os/llm/aiActionAudit';")).toBe(true);
    expect(SERVER_ONLY_MODULES.test("import { diaryLabelFor } from '@/lib/business-os/credits/effectiveFields';")).toBe(true);
    expect(SERVER_ONLY_MODULES.test("import type { X } from '@/lib/business-os/credits/creditHistoryTypes';")).toBe(false);
  });

  it('none of the client files does', () => {
    const files = ['app', 'components', 'hooks', 'lib'].flatMap(clientFiles);
    // Non-vacuity: the panel and the card are client files and are scanned.
    expect(files).toEqual(expect.arrayContaining([CARD, HISTORY_PANEL]));
    expect(files.filter((file) => SERVER_ONLY_MODULES.test(codeOf(read(file))))).toEqual([]);
  });
});
