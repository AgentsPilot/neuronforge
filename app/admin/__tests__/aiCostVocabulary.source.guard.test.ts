/**
 * Source guard: one vocabulary for admin AI cost (Money M-4 Part A, OV-1;
 * SA-Q51, SA-W97, SA-WR-47; AC-150, AC-152).
 *
 * Every admin AI cost figure is called "Charged AI cost" (the credit ledger) or
 * "Recorded AI cost" (the usage log). The old names ("estimated", "AI spend",
 * "Cost Analytics", …) must not come back on the pages that show those figures.
 *
 * How it reads a file: the TypeScript AST, never a regex over the source, so a
 * comment can neither trip it nor satisfy it.
 *   - Scanned: string literals, no-substitution templates, template head /
 *     middle / tail (one text per template, `${}` where an expression sits),
 *     JSX text, and JSX attribute values — `aria-label`, `title`,
 *     `placeholder` and `label` included, because they are read aloud or shown
 *     (SA-WR-47). A `+` chain made only of literals is folded into one text
 *     first; whitespace is collapsed to one space (JSX text spans lines).
 *   - Never scanned: identifiers and property names, import / export
 *     specifiers, element-access keys, literal types, comments, and the values
 *     of the JSX attributes `data-testid`, `testId`, `className`, `key`, `id`
 *     and `href` — testids, metric names and URLs are not copy (SA-W97).
 *
 * Money M-5 (finance health §11H.5, AC-199) widened the scan: the Health rule
 * descriptions and metric labels (`lib/admin/health/rules.ts`, S-14, S-15),
 * the Scheduled jobs registry (`lib/cron/bosCronJobs.ts`, whose credit leak
 * check row said "AI spend", S-16, S-17), the Charge checks page, and AI calls
 * & usage's bar noun (`AnalyticsFilterBar.tsx`, S-18). That closes FU-M4-1.
 * The Leak check's known-path reason texts keep "spend" (SA-W96); none of
 * them matches a forbidden phrase.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const ROOT = process.cwd();

/** The §11F.4 places (W-1 to W-28), and Part B's Section 3 block (Money M-4 OV-5, B.11). */
const FILES = [
  'app/admin/finance/financeCopy.ts',
  'app/admin/finance/components/AiCostSection.tsx',
  'app/admin/analytics/page.tsx',
  'app/admin/analytics/components/AnalyticsKpis.tsx',
  'app/admin/business-os-llm/costCopy.ts',
  'app/admin/business-os-llm/leakCopy.ts',
  'app/admin/business-os-llm/activityCopy.ts',
  'app/admin/business-os-llm/components/activity/CutoverNotice.tsx',
  'lib/admin/health/evaluateHealth.ts',
  'app/admin/users/components/BusinessSummaryStrip.tsx',
  'app/admin/users/components/BusinessOsPanel.tsx',
  'app/admin/users/components/AllProductsUsage.tsx',
  'app/admin/users/components/DrawerBox.tsx',
  'app/admin/finance/components/RecordedCostLines.tsx',
  // Money M-5 (AC-199).
  'lib/admin/health/rules.ts',
  'lib/cron/bosCronJobs.ts',
  'app/admin/finance/charges/page.tsx',
  'app/admin/analytics/components/AnalyticsFilterBar.tsx',
] as const;
type GuardedFile = (typeof FILES)[number];

/** SA-Q51's list, exactly. Matched case-insensitively. */
const FORBIDDEN = [
  'estimated',
  'provider-side',
  'measured cost',
  'measured price',
  'Cost Analytics',
  'AI spend',
  'Total spend',
  'Uncharged spend',
] as const;

/**
 * Explicit exceptions, each with its reason. Empty at M-4 Part A. An entry that
 * no longer matches anything fails the guard (no slack is left behind).
 */
const ALLOWED: ReadonlyArray<{ file: GuardedFile; phrase: (typeof FORBIDDEN)[number]; reason: string }> = [];

/** JSX attributes whose values are identifiers or targets, never shown text. */
const SKIPPED_ATTRIBUTES = new Set(['data-testid', 'testId', 'className', 'key', 'id', 'href']);

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function isLiteralText(n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
}

/** A `+` chain made only of string literals, folded; null if any operand is not a literal. */
function foldPlusChain(n: ts.Node): string | null {
  if (isLiteralText(n)) return n.text;
  if (ts.isParenthesizedExpression(n)) return foldPlusChain(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldPlusChain(n.left);
    const right = left === null ? null : foldPlusChain(n.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/** Every visible text in a source file, in source order. */
function visibleTexts(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const push = (s: string) => {
    const text = collapse(s);
    if (text) out.push(text);
  };

  const visit = (n: ts.Node): void => {
    // Never scanned: module specifiers, literal types, keys and attribute values that are not copy.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportTypeNode(n)) return;
    if (ts.isLiteralTypeNode(n)) return;
    if (ts.isJsxAttribute(n) && SKIPPED_ATTRIBUTES.has(n.name.getText(sf))) return;
    if (ts.isElementAccessExpression(n)) {
      visit(n.expression);
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      visit(n.initializer);
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const folded = foldPlusChain(n);
      if (folded !== null) {
        push(folded);
        return;
      }
    }
    if (isLiteralText(n)) {
      push(n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      push(n.head.text + n.templateSpans.map((s) => '${}' + s.literal.text).join(''));
      n.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    if (ts.isJsxText(n)) {
      push(n.text);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function offences(texts: string[]): Array<{ phrase: string; text: string }> {
  const found: Array<{ phrase: string; text: string }> = [];
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const phrase of FORBIDDEN) if (lower.includes(phrase.toLowerCase())) found.push({ phrase, text });
  }
  return found;
}

const TEXTS = new Map<GuardedFile, string[]>(
  FILES.map((f) => [f, visibleTexts(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))])
);
const textsOf = (f: GuardedFile) => TEXTS.get(f)!;

describe('the guard reads real files (non-vacuity, SA-Q51)', () => {
  it('scans the thirteen §11F.4 files, the Part B block and the four M-5 files', () => {
    expect(FILES).toHaveLength(18);
    expect(new Set(FILES).size).toBe(18);
  });

  // The number of visible texts each file had when the guard was written. A
  // scanner that silently finds nothing (a parse change, a moved file) fails here.
  const MIN_TEXTS: Record<GuardedFile, number> = {
    'app/admin/finance/financeCopy.ts': 439,
    // 28 since F-1: the local TH/TD class-name constants (counted as texts) moved
    // to the shared adminTable constants; no visible copy changed.
    'app/admin/finance/components/AiCostSection.tsx': 28,
    'app/admin/analytics/page.tsx': 71,
    'app/admin/analytics/components/AnalyticsKpis.tsx': 33,
    'app/admin/business-os-llm/costCopy.ts': 44,
    'app/admin/business-os-llm/leakCopy.ts': 62,
    'app/admin/business-os-llm/activityCopy.ts': 142,
    'app/admin/business-os-llm/components/activity/CutoverNotice.tsx': 9,
    'lib/admin/health/evaluateHealth.ts': 217,
    'app/admin/users/components/BusinessSummaryStrip.tsx': 15,
    'app/admin/users/components/BusinessOsPanel.tsx': 111,
    'app/admin/users/components/AllProductsUsage.tsx': 16,
    'app/admin/users/components/DrawerBox.tsx': 18,
    'app/admin/finance/components/RecordedCostLines.tsx': 7,
    // Money M-5, measured with this file's own scanner after the M-5 edits.
    'lib/admin/health/rules.ts': 184,
    'lib/cron/bosCronJobs.ts': 580,
    'app/admin/finance/charges/page.tsx': 2,
    'app/admin/analytics/components/AnalyticsFilterBar.tsx': 50,
  };
  it.each(FILES)('%s has at least its pinned number of visible texts', (f) => {
    expect(textsOf(f).length).toBeGreaterThanOrEqual(MIN_TEXTS[f]);
  });
});

describe('no forbidden phrase in any visible text (AC-152)', () => {
  it.each(FILES)('%s', (f) => {
    const allowed = ALLOWED.filter((a) => a.file === f);
    const left = offences(textsOf(f)).filter((o) => !allowed.some((a) => a.phrase === o.phrase));
    expect(left).toEqual([]);
  });

  it('every allow-list entry still matches something and gives a real reason', () => {
    for (const a of ALLOWED) {
      expect(a.reason.length).toBeGreaterThan(30);
      expect(offences(textsOf(a.file)).some((o) => o.phrase === a.phrase)).toBe(true);
    }
  });
});

describe('planted controls: the scanner finds what it must and skips what it must (AC-152, SA-WR-47)', () => {
  const count = (source: string, fileName = 'planted.tsx') => offences(visibleTexts(fileName, source)).length;

  it.each([
    ['a string literal', `const x = 'Costs are USD, estimated';`],
    ['JSX text', `const a = <p>Total spend</p>;`],
    ['a + chain folded first', `const y = 'Recorded, ' + 'estimated';`],
    ['a + chain split across the phrase', `const y = 'Uncharged ' + 'spend';`],
    ['JSX text broken over two lines', `const b = (\n  <p>\n    measured\n    cost\n  </p>\n);`],
    ['a template part', 'const t = (n: number) => `${n} businesses with Cost Analytics`;'],
    ['an aria-label value (SA-WR-47)', `const c = <span aria-label="AI spend">x</span>;`],
    ['a title value (SA-WR-47)', `const d = <span title="Total spend">x</span>;`],
    ['a placeholder value', `const e = <input placeholder="provider-side" />;`],
    ['a label prop', `const g = <Tile label="Measured price" />;`],
  ])('%s gives exactly one offence', (_name, source) => {
    expect(count(source)).toBe(1);
  });

  it.each([
    ['a testid', `const a = <div data-testid="strip-ai-spend" />;`],
    ['a testId prop', `const a = <Field testId="estimated-cost" />;`],
    ['a className', `const a = <div className="estimated" />;`],
    ['an id and a key', `const a = <div id="estimated" key="AI spend" />;`],
    ['an href', `const a = <a href="/admin/estimated">x</a>;`],
    ['a metric or tile id string with no space', `const k = 'bos_ai_spend';`],
    ['an identifier', `const v = x.estimatedCostUsd;`],
    ['an import specifier', `import x from './estimated';`],
    ['a property name', `const o = { 'AI spend': 1, estimated: 2 };`],
    ['an element-access key', `const v = o['Total spend'];`],
    ['a literal type', `type T = 'estimated' | 'exact';`],
    ['a comment', `// estimated AI spend from Cost Analytics\nconst z = 1;`],
  ])('%s gives no offence', (_name, source) => {
    expect(count(source)).toBe(0);
  });
});

// ── AC-150: every W row's new text is there, and no old text is ────────────
// A template is read with `${}` where its expression sits.

const FIN = 'app/admin/finance/financeCopy.ts';
const SECTION3 = 'app/admin/finance/components/AiCostSection.tsx';
const ANALYTICS = 'app/admin/analytics/page.tsx';
const KPIS = 'app/admin/analytics/components/AnalyticsKpis.tsx';
const COSTS = 'app/admin/business-os-llm/costCopy.ts';
const LEAK = 'app/admin/business-os-llm/leakCopy.ts';
const ACTIVITY = 'app/admin/business-os-llm/activityCopy.ts';
const HEALTH = 'lib/admin/health/evaluateHealth.ts';
const STRIP = 'app/admin/users/components/BusinessSummaryStrip.tsx';
const PANEL = 'app/admin/users/components/BusinessOsPanel.tsx';
const ALL_PRODUCTS = 'app/admin/users/components/AllProductsUsage.tsx';
const DRAWER_BOX = 'app/admin/users/components/DrawerBox.tsx';
const RULES = 'lib/admin/health/rules.ts';
const CRON = 'lib/cron/bosCronJobs.ts';
const ANALYTICS_BAR = 'app/admin/analytics/components/AnalyticsFilterBar.tsx';

/** `exact`: one whole visible text equals it; otherwise one contains it. */
const NEW_TEXTS: ReadonlyArray<{ row: string; file: GuardedFile; text: string; exact?: true }> = [
  { row: 'W-1', file: FIN, text: 'Charged AI cost this month', exact: true },
  { row: 'W-2', file: FIN, text: 'Charged AI cost in the window', exact: true },
  {
    row: 'W-3',
    file: FIN,
    text: 'Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it.',
    exact: true,
  },
  { row: 'W-4 / W-8', file: FIN, text: 'Charged AI cost (USD)', exact: true },
  { row: 'W-5', file: FIN, text: 'Top 10 businesses by charged AI cost', exact: true },
  { row: 'W-6', file: FIN, text: 'Every recorded AI call, charged or not:', exact: true },
  { row: 'W-7', file: FIN, text: 'Charged AI cost', exact: true },
  { row: 'W-9a', file: FIN, text: 'AI cost is the charged AI cost (credits we billed); the recorded AI cost is not used here.', exact: true },
  { row: 'W-9b', file: FIN, text: 'Charged AI cost, highest first', exact: true },
  { row: 'W-28', file: FIN, text: 'The window starts before AI charging went live: see Charged AI cost in the window below.', exact: true },
  { row: 'E-59 (SA-W90) subtitle join, window first', file: SECTION3, text: '${}. ${}', exact: true },
  {
    row: 'W-10',
    file: ANALYTICS,
    text:
      'Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, including calls before charging ' +
      'started on 29 Sep 2026 and legacy-tagged Business OS rows. USD, priced from the model price table. The charged cost is on Finance.',
    exact: true,
  },
  { row: 'W-11', file: ANALYTICS, text: 'Recorded AI cost, both products: every AI call in the usage log. USD, priced from the model price table.', exact: true },
  { row: 'W-12a', file: KPIS, text: 'Recorded AI cost', exact: true },
  { row: 'W-12b', file: KPIS, text: '${}% of recorded cost · ${} tokens · ${}', exact: true },
  {
    row: 'W-13',
    file: COSTS,
    text:
      'Charged AI cost: what Business OS actions cost us (USD, priced from the model price table) and what we charged (credits), ' +
      'per account and billing period. Read from the credit ledger; nothing here changes it. Monthly totals are on Finance.',
    exact: true,
  },
  { row: 'W-14', file: COSTS, text: 'Charged AI cost (USD)', exact: true },
  {
    row: 'W-15',
    file: COSTS,
    text: 'Charged from a fallback price because the model had no price in the price table: a deliberate over-estimate. Reconciling them is a later part of this work.',
    exact: true,
  },
  { row: 'W-16a', file: LEAK, text: 'No recorded AI cost left uncharged', exact: true },
  { row: 'W-16b', file: LEAK, text: '${} business${} with recorded AI cost not charged (${})', exact: true },
  { row: 'W-16c', file: LEAK, text: 'Recorded, not charged', exact: true },
  {
    row: 'W-17',
    file: ACTIVITY,
    text: 'One row per Business OS AI action: what ran, for which business, whether it worked and its charged AI cost. Read from the credit ledger; nothing here changes it.',
    exact: true,
  },
  { row: 'W-18a', file: ACTIVITY, text: 'Charged AI cost (USD, net)', exact: true },
  {
    row: 'W-19a',
    file: ACTIVITY,
    // M-5 S-9: the page's new name.
    text: 'For AI activity before then, see the audit trail’s AI action entries or the recorded AI cost in AI calls & usage.',
  },
  { row: 'W-19b / S-9', file: ACTIVITY, text: 'AI calls & usage (Business OS, recorded)', exact: true },
  { row: 'W-20', file: HEALTH, text: 'Recorded AI cost (USD)', exact: true },
  { row: 'W-21a', file: HEALTH, text: 'Recorded AI cost, last 24 h (USD)', exact: true },
  { row: 'W-21b', file: HEALTH, text: 'Recorded AI cost, last 7 days (USD)', exact: true },
  { row: 'W-21c / S-12', file: HEALTH, text: 'Recorded AI cost, ${}: ${}, open in AI calls & usage', exact: true },
  {
    row: 'W-22',
    file: HEALTH,
    text: 'USD: every Business OS AI call in the usage log, charged or not, priced from the model price table; never mixed with a business currency. The charged AI cost is on Finance. ',
  },
  { row: 'W-23a', file: STRIP, text: 'Recorded AI cost, 30 days', exact: true },
  { row: 'W-23b', file: PANEL, text: 'recorded, a lower bound', exact: true },
  { row: 'W-23b', file: PANEL, text: 'recorded', exact: true },
  { row: 'W-24', file: PANEL, text: 'Recorded AI cost, Business OS, last 30 days (USD)', exact: true },
  { row: 'W-25a', file: ALL_PRODUCTS, text: 'All products, recorded AI cost (30 days; may be incomplete above 1,000 calls)', exact: true },
  { row: 'W-25b', file: ALL_PRODUCTS, text: 'Recorded AI cost by model (highest first)', exact: true },
  { row: 'W-25c', file: ALL_PRODUCTS, text: 'Recorded AI cost', exact: true },
  { row: 'W-27', file: DRAWER_BOX, text: "Recorded AI cost of this business's Business OS AI calls, in USD.", exact: true },
  // Money M-4 Part B (OV-5, M4-FR-1, M4-FR-2, E-54): the new Section 3 labels, in the finance copy.
  { row: 'M4-FR-1 caption', file: FIN, text: 'Beside the charged cost, never added', exact: true },
  { row: 'M4-FR-1 recorded', file: FIN, text: 'Recorded AI cost (USD)', exact: true },
  { row: 'M4-FR-1 recorded source', file: FIN, text: 'Usage log: every Business OS AI call, charged or not, priced from the model price table', exact: true },
  { row: 'M4-FR-1 / E-54 above', file: FIN, text: 'Recorded above charged (USD)', exact: true },
  { row: 'M4-FR-1 above source', file: FIN, text: 'Recorded AI cost minus charged AI cost, for the same window. Which calls: run the', exact: true },
  { row: 'M4-FR-2 / E-54 summary', file: FIN, text: 'Recorded above charged', exact: true },
  { row: 'R4-5', file: FIN, text: 'Not available: AI charging began 29 Sep 2026', exact: true },
  // Money M-5 (§11H.5 S-5 to S-18; AC-195, AC-199).
  { row: 'S-5', file: ANALYTICS, text: 'AI calls & usage (detail)', exact: true },
  { row: 'S-6', file: COSTS, text: 'Charge checks', exact: true },
  { row: 'S-7', file: FIN, text: 'AI calls & usage', exact: true },
  { row: 'S-8', file: FIN, text: 'Charge checks', exact: true },
  { row: 'S-10', file: ACTIVITY, text: 'Platform AI calls are counted by the Leak check on Charge checks.' },
  { row: 'S-11', file: PANEL, text: 'Open in AI calls & usage', exact: true },
  { row: 'S-12 note', file: HEALTH, text: 'AI calls & usage reads at most 1,000 calls per period (known issue OI-P1), so it will show less than this.', exact: true },
  { row: 'S-12 footnote', file: HEALTH, text: 'The comparison with the previous period is computed here from one read; AI calls & usage computes' },
  { row: 'S-13', file: HEALTH, text: 'Charged AI cost: open Finance', exact: true },
  { row: 'S-14a', file: RULES, text: '24 h recorded AI cost', exact: true },
  { row: 'S-14b', file: RULES, text: 'previous 24 h recorded AI cost', exact: true },
  { row: 'S-14c', file: RULES, text: '7-day recorded AI cost', exact: true },
  { row: 'S-14d', file: RULES, text: 'previous 7-day recorded AI cost', exact: true },
  { row: 'S-15a', file: RULES, text: 'Recorded AI cost tripled vs yesterday', exact: true },
  { row: 'S-15b', file: RULES, text: 'Recorded AI cost doubled vs yesterday', exact: true },
  { row: 'S-15c', file: RULES, text: 'Recorded AI cost up 50% or more on the week', exact: true },
  { row: 'S-16', file: CRON, text: "Checks that yesterday's recorded Business OS AI cost was all charged", exact: true },
  { row: 'S-17', file: CRON, text: 'businesses with recorded AI cost not charged', exact: true },
  { row: 'S-18', file: ANALYTICS_BAR, text: 'AI calls and usage', exact: true },
];

/** Exact whole texts: "AI cost (USD)" never matches inside "Charged AI cost (USD)". */
const OLD_TEXTS: ReadonlyArray<{ row: string; files: readonly GuardedFile[] | 'all'; text: string }> = [
  { row: 'W-1', files: 'all', text: 'AI cost this month' },
  { row: 'W-2', files: 'all', text: 'AI cost in the window' },
  { row: 'W-3', files: 'all', text: 'Credit ledger, charges and corrections' },
  { row: 'W-4', files: 'all', text: 'AI cost (USD)' },
  { row: 'W-5', files: 'all', text: 'Top 10 businesses by AI cost' },
  { row: 'W-6', files: 'all', text: 'For the provider-side token measure, see' },
  { row: 'W-7', files: 'all', text: 'AI cost, charged' },
  { row: 'W-8', files: 'all', text: 'AI cost, charged (USD)' },
  { row: 'W-9a', files: 'all', text: 'AI cost is the charged cost (credits we billed).' },
  { row: 'W-9b', files: 'all', text: 'AI cost, highest first' },
  { row: 'W-28', files: 'all', text: 'The window starts before AI charging went live: see AI cost in the window below.' },
  { row: 'E-59 old join (source, then window)', files: [SECTION3], text: '${}, ${}' },
  {
    row: 'W-10',
    files: 'all',
    text: 'Business OS only: includes legacy-tagged Business OS rows. Costs are USD, estimated from the model pricing table.',
  },
  { row: 'W-11', files: 'all', text: 'Both products. Costs are USD, estimated from the model pricing table.' },
  { row: 'W-12a', files: 'all', text: 'Total spend' },
  { row: 'W-12b', files: 'all', text: '${}% of spend · ${} tokens · ${}' },
  {
    row: 'W-13',
    files: 'all',
    text:
      'What Business OS actions cost us (USD, the provider’s measured cost) and what we charged (credits), per account and ' +
      'billing period. Read from the credit ledger; nothing here changes it.',
  },
  // "Cost (USD)" stays as Section 3's column (SA-W93), so it is gone only where W-14 and W-18 renamed it.
  { row: 'W-14 / W-18b / W-18c / W-18 (:245)', files: [COSTS, ACTIVITY], text: 'Cost (USD)' },
  {
    row: 'W-15',
    files: 'all',
    text: 'Charged from a fallback price because the measured price was missing — a deliberate over-estimate. Reconciling them is a later part of this work.',
  },
  { row: 'W-16a', files: 'all', text: 'No uncharged AI spend found' },
  { row: 'W-16b', files: 'all', text: '${} business${} with uncharged AI spend (${} not charged)' },
  { row: 'W-16c', files: 'all', text: 'Uncharged spend' },
  {
    row: 'W-17',
    files: 'all',
    text: 'One row per Business OS AI action: what ran, for which business, whether it worked and what it cost. Read from the credit ledger; nothing here changes it.',
  },
  { row: 'W-18a', files: 'all', text: 'Cost (USD, net)' },
  {
    row: 'W-19a',
    files: 'all',
    text:
      'Charging went live on 29 September 2026 at 16:50 UTC, so this list starts there. ' +
      'For AI activity before then, see the audit trail’s AI action entries or Cost Analytics.',
  },
  { row: 'W-19b', files: 'all', text: 'Cost Analytics (Business OS)' },
  { row: 'W-20', files: 'all', text: 'Business OS AI spend (USD, estimated)' },
  { row: 'W-21a', files: 'all', text: 'AI spend, last 24 h (USD)' },
  { row: 'W-21b', files: 'all', text: 'AI spend, last 7 days (USD)' },
  { row: 'W-21c', files: 'all', text: 'Business OS AI spend, ${}: ${}, open in AI cost & usage' },
  { row: 'W-23a', files: 'all', text: 'Business OS AI, 30 days' },
  { row: 'W-23b', files: 'all', text: 'estimated, a lower bound' },
  { row: 'W-23b', files: 'all', text: 'estimated' },
  { row: 'W-24', files: 'all', text: 'Business OS, last 30 days (USD estimated)' },
  { row: 'W-25a', files: 'all', text: 'All products, token records (30 days; may be incomplete above 1,000 calls)' },
  { row: 'W-25b', files: 'all', text: 'Cost by Model (highest cost first)' },
  { row: 'W-25c', files: 'all', text: 'Total Cost' },
  { row: 'W-27', files: 'all', text: "Estimated cost of this business's Business OS AI calls, in USD." },
  // Money M-5 (§11H.5): the old names and the FU-M4-1 "spend" wording.
  { row: 'S-1 / S-5 / S-7', files: 'all', text: 'AI cost & usage' },
  { row: 'S-6 / S-8', files: 'all', text: 'Costs & credits' },
  { row: 'S-8', files: 'all', text: 'Business OS AI Costs & credits' },
  { row: 'S-9', files: 'all', text: 'AI cost & usage (Business OS, recorded)' },
  { row: 'S-10', files: 'all', text: 'Platform AI calls are counted by the leak check on the Costs & credits tab.' },
  { row: 'S-11', files: 'all', text: 'Open in AI cost & usage' },
  { row: 'S-12', files: 'all', text: 'Recorded AI cost, ${}: ${}, open in AI cost & usage' },
  { row: 'S-12', files: 'all', text: 'AI cost & usage reads at most 1,000 calls per period (known issue OI-P1), so it will show less than this.' },
  { row: 'S-14a', files: 'all', text: '24 h spend' },
  { row: 'S-14b', files: 'all', text: 'previous 24 h spend' },
  { row: 'S-14c', files: 'all', text: '7-day spend' },
  { row: 'S-14d', files: 'all', text: 'previous 7-day spend' },
  { row: 'S-15a', files: 'all', text: 'Spend tripled vs yesterday' },
  { row: 'S-15b', files: 'all', text: 'Spend doubled vs yesterday' },
  { row: 'S-15c', files: 'all', text: 'Week up 50% or more' },
  { row: 'S-16', files: 'all', text: "Checks that yesterday's Business OS AI spend was all charged" },
  { row: 'S-17', files: 'all', text: 'businesses with uncharged AI spend' },
  { row: 'S-18', files: 'all', text: 'AI cost and usage' },
];

describe('AC-150: the new texts are present', () => {
  it.each(NEW_TEXTS.map((n) => [n.row, n.file, n.text, n.exact === true] as const))('%s in %s', (_row, file, text, exact) => {
    const texts = textsOf(file);
    expect(exact ? texts.includes(text) : texts.some((t) => t.includes(text))).toBe(true);
  });

  it('W-18b, W-18c and :245 (SA-W91): the three ledger cost labels in Activity all say "Charged AI cost (USD)"', () => {
    expect(textsOf(ACTIVITY).filter((t) => t === 'Charged AI cost (USD)')).toHaveLength(3);
  });
});

describe('AC-150: the old texts are gone (exact whole texts)', () => {
  it.each(OLD_TEXTS.map((o) => [o.row, o.text, o.files] as const))('%s: "%s"', (_row, text, files) => {
    const scope = files === 'all' ? FILES : files;
    for (const f of scope) expect(textsOf(f)).not.toContain(text);
  });

  it('control: the same check finds an old text when it is there', () => {
    expect(visibleTexts('planted.ts', `export const AI_TOTAL = 'AI cost (USD)';`)).toContain('AI cost (USD)');
    expect(visibleTexts('planted.ts', `export const AI_TOTAL = 'Charged AI cost (USD)';`)).not.toContain('AI cost (USD)');
  });
});
