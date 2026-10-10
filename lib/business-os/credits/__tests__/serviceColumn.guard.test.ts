/**
 * N-10 / KI-14 — nobody filters or groups the credit ledger on the RAW
 * `service` column.
 *
 * An adjustment row stores `service` NULL and inherits it from the charge it
 * corrects. A query `.eq('service', 'ai')`, a SQL `GROUP BY service`, or a Node
 * grouping on `row.service` silently drops every correction from its service.
 * The effective service is resolved in ONE place, `effectiveFields.ts`; every
 * other file in the credits module and the read repository must go through it.
 *
 * Every rule is proved against a planted violation first: a rule that cannot
 * match reads exactly like a rule that found nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const CREDITS_DIR = 'lib/business-os/credits';
const READ_REPOSITORY = 'lib/repositories/BusinessOsCreditLedgerReadRepository.ts';
/** Slice 6a: the owner's own ledger read. It SELECTS `service` (for the resolver) and must never filter on it. */
const OWNER_READ_REPOSITORY = 'lib/repositories/BusinessOsCreditOwnerReadRepository.ts';
/** The one file allowed to read a row's own `service`. */
const RESOLVER = `${CREDITS_DIR}/effectiveFields.ts`;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Comments stripped: prose about the column is not a query on it. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RULES = [
  {
    name: 'a PostgREST filter or order on service',
    pattern: /\.(eq|neq|in|is|like|ilike|filter|order|or|match|not)\(\s*['"`]service['"`]/,
    mustMatch: [`q.eq('service', 'ai')`, `q.in("service", list)`, 'q.order(`service`)'],
  },
  {
    name: 'an or-expression on service',
    pattern: /['"`][^'"`]*\bservice\.(eq|in|is|neq)\./,
    mustMatch: [`q.or('service.eq.ai,kind.eq.adjustment')`],
  },
  {
    name: 'SQL grouping or filtering on service',
    pattern: /group\s+by\s+(\w+\.)?service\b|where\s+(\w+\.)?service\s*=|\band\s+(\w+\.)?service\s*=/i,
    mustMatch: ['SELECT sum(credits) FROM c GROUP BY service', 'where c.service = $1'],
  },
  {
    name: 'a Node read of a row\'s own service (outside the resolver)',
    pattern: /\.service\b/,
    mustMatch: ['groupBy(rows, (r) => r.service)', 'if (row.service === "ai")'],
  },
] as const;

/**
 * The admin AI Activity view (Gap B slice B1a, NFR-4.5, SA-RC-2): its route and
 * its screen live OUTSIDE the credits module, so they are listed here. The rule
 * applies to the view "wherever it lives": the screen is walked, so a component
 * added tomorrow is covered.
 */
const ACTIVITY_ROUTE = 'app/api/admin/business-os/ai-activity/route.ts';
/** Gap B slice B2a: the drill-down route, outside the credits module too. */
const ACTIVITY_DRILL_DOWN_ROUTE = 'app/api/admin/business-os/ai-activity/drill-down/route.ts';
const ACTIVITY_SCREEN_DIR = 'app/admin/business-os-llm/components/activity';
const ACTIVITY_SCREEN_MODULES = [
  'app/admin/business-os-llm/activityTypes.ts',
  'app/admin/business-os-llm/activityCopy.ts',
  'app/admin/business-os-llm/activityPresets.ts',
  // B2a: the drill-down's client mirror.
  'app/admin/business-os-llm/activityDrillDownTypes.ts',
];

/**
 * Finance & business health slice 1a: the finance builder, its route and its
 * page live outside the credits module and sum the ledger, so they are walked
 * here too. Grouping goes through `resolveEffectiveFields` only.
 */
const FINANCE_DIR = 'lib/business-os/finance';
const FINANCE_ROUTE = 'app/api/admin/business-os/finance/route.ts';
const FINANCE_PAGE_DIR = 'app/admin/finance';

const files = [
  ...sourceFiles(CREDITS_DIR),
  READ_REPOSITORY,
  OWNER_READ_REPOSITORY,
  ACTIVITY_ROUTE,
  ACTIVITY_DRILL_DOWN_ROUTE,
  ...sourceFiles(ACTIVITY_SCREEN_DIR),
  ...ACTIVITY_SCREEN_MODULES,
  ...sourceFiles(FINANCE_DIR),
  FINANCE_ROUTE,
  ...sourceFiles(FINANCE_PAGE_DIR),
];

describe('N-10: no grouping or filtering on the raw service column', () => {
  it('scans the credits module, both read repositories, the AI Activity view and the finance page', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        RESOLVER,
        `${CREDITS_DIR}/creditReport.ts`,
        `${CREDITS_DIR}/ownerCreditUsage.ts`,
        READ_REPOSITORY,
        OWNER_READ_REPOSITORY,
        // The Activity view's server half: named explicitly, so moving a file
        // out of the credits directory turns this red instead of silently
        // dropping it from the scan.
        `${CREDITS_DIR}/aiActivity.ts`,
        `${CREDITS_DIR}/aiActivityDeps.ts`,
        `${CREDITS_DIR}/aiActivityTypes.ts`,
        ACTIVITY_ROUTE,
        `${ACTIVITY_SCREEN_DIR}/ActivityTab.tsx`,
        `${ACTIVITY_SCREEN_DIR}/ActivityTable.tsx`,
        // The drill-down (B2a), named for the same reason.
        `${CREDITS_DIR}/aiActivityDrillDown.ts`,
        `${CREDITS_DIR}/aiActivityDrillDownDeps.ts`,
        `${CREDITS_DIR}/aiActivityDrillDownTypes.ts`,
        ACTIVITY_DRILL_DOWN_ROUTE,
        `${ACTIVITY_SCREEN_DIR}/ActivityDrillDown.tsx`,
        `${ACTIVITY_SCREEN_DIR}/DrillDownCharges.tsx`,
        ...ACTIVITY_SCREEN_MODULES,
        // Finance 1a, named so moving a file turns this red.
        `${FINANCE_DIR}/aiCost.ts`,
        `${FINANCE_DIR}/financeHealth.ts`,
        `${FINANCE_DIR}/financeHealthDeps.ts`,
        FINANCE_ROUTE,
        `${FINANCE_PAGE_DIR}/components/AiCostSection.tsx`,
      ])
    );
  });

  it.each(RULES.map((r) => [r.name, r] as const))('the rule "%s" matches its planted violations', (_n, rule) => {
    for (const sample of rule.mustMatch) {
      expect({ sample, matched: rule.pattern.test(sample) }).toEqual({ sample, matched: true });
    }
  });

  it('the Node rule does not fire on the resolved field name', () => {
    expect(/\.service\b/.test('f.effectiveService')).toBe(false);
  });

  it.each(files)('%s obeys every rule', (file) => {
    const code = codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const rule of RULES) {
      // The resolver is the one place a row's own service is read.
      if (file === RESOLVER && rule.name.startsWith('a Node read')) continue;
      expect({ file, rule: rule.name, matched: rule.pattern.test(code) }).toEqual({
        file,
        rule: rule.name,
        matched: false,
      });
    }
  });
});

describe('slice 7a: the credit history\'s paged read is covered by name (workplan §4.11)', () => {
  it('listLedgerRowsForWindow exists in the scanned owner repository and has no filter, order or grouping on service', () => {
    const code = codeOf(fs.readFileSync(path.join(ROOT, OWNER_READ_REPOSITORY), 'utf8'));
    const start = code.indexOf('async listLedgerRowsForWindow(');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('\n  }\n', start));
    for (const rule of RULES) expect({ rule: rule.name, matched: rule.pattern.test(body) }).toEqual({ rule: rule.name, matched: false });
  });
});
