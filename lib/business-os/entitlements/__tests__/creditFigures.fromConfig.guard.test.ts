/**
 * Credit numbers come ONLY from configuration (user requirement, 2026-10-01).
 *
 * The plan screen, the public invite page and the dashboard card all show a
 * credit allowance. Each must read it from the tier matrix / the trial constant
 * through the resolver, with dictionary strings acting only as templates
 * ("{n} per month"). A figure typed into a dictionary string or a component is
 * a second copy of the price list, and it is the copy that goes stale the day a
 * plan is re-priced — silently, in front of a customer.
 *
 * This guard fails if any of the owner / invite surfaces below contains a
 * literal credit figure. Excluded, by design: the config files that ARE the
 * source (`lib/business-os/entitlements/config/**`) and tests.
 *
 * The figures checked are the user's list AND whatever the config holds today,
 * so a re-price keeps the guard meaningful without editing it.
 *
 * Comments are stripped before scanning: a comment may explain an example; only
 * code and copy reach a customer.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

/** The user's list (2026-10-01): Essentials, Autopilot / Founding Partner, trial. */
const USER_LISTED = [19750, 32250, 2000];

const config = readCodeConfig();
const NOW = new Date('2026-10-01T00:00:00.000Z');

/** Every allowance figure the config produces today, through the resolver. */
const CONFIGURED = [...config.tierOrder, ...Object.keys(config.cohorts)].flatMap((planId) => {
  const value = resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW })
    .values['credits.allowance']?.value as { perMonth?: number; total?: number } | undefined;
  return [value?.perMonth, value?.total].filter((n): n is number => typeof n === 'number' && n >= 1000);
});

const FIGURES = [...new Set([...USER_LISTED, ...CONFIGURED])];

/**
 * A figure in any of the ways it could be typed: `19750`, `19,750`, `19.750`,
 * `19 750` (incl. no-break / narrow no-break space), `19_750`. Not part of a
 * longer number on either side.
 */
function figurePattern(n: number): RegExp {
  const digits = String(n);
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(-3);
  return new RegExp(`(?<![\\d.,])${head}[,.\\s\\u00a0\\u202f_]?${tail}(?![\\d])`);
}

function findFigures(text: string): string[] {
  return FIGURES.filter((n) => figurePattern(n).test(text)).map(String);
}

/** Block comments, whole-line `//` comments and trailing ` // …` comments. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');
}

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/**
 * Components and pages that render a credit allowance, and the server code that builds what they render.
 *
 * ── Adding a surface ─────────────────────────────────────────────────────────
 * This is an allow-list, so a NEW screen that shows an allowance (a pricing
 * page, an upgrade dialog, a boost purchase screen) is not checked until it is
 * listed here — add it. The completeness test below catches the common case:
 * any product file that calls one of the plan / credit display builders
 * (`BUILDERS`) must be in this list, or the suite fails and names the file.
 */
const SOURCES = [
  // Pages and components
  'components/business-os/settings/PlanSection.tsx',
  'components/business-os/UsageCard.tsx',
  'app/invite/page.tsx',
  // Copy modules (whole file)
  'app/invite/invitePageCopy.ts',
  'lib/i18n/creditExplanation.ts',
  // What builds the payloads
  'app/api/business-os/entitlements/my-plan/route.ts',
  'app/api/business-os/usage/route.ts',
  'lib/business-os/entitlements/customerPlanView.ts',
  'lib/business-os/entitlements/planOfferView.ts',
  'lib/business-os/entitlements/planPresentation.ts',
  'lib/business-os/entitlements/capabilityDisplay.ts',
  'lib/business-os/entitlements/creditAllowanceView.ts',
  'lib/business-os/invites/inviteOffer.ts',
  'lib/business-os/invites/publicInviteView.ts',
  'lib/business-os/credits/ownerCreditUsage.ts',
  'lib/business-os/credits/creditDisplay.ts',
  'lib/business-os/credits/creditBalance.ts',
  'lib/business-os/credits/ownerCreditUsageDeps.ts',
  // Credit deduction slice 7a — the credit history (SA W7-3).
  'app/api/business-os/credits/history/route.ts',
  'lib/business-os/credits/ownerCreditHistory.ts',
  'components/business-os/CreditHistoryPanel.tsx',
  // Credit deduction slice 8a — the admin "Credits left" column (names `creditAllowanceForDisplay`).
  'lib/business-os/credits/adminCreditPercent.ts',
  'app/admin/users/components/CreditsLeftCell.tsx',
  // The one presentation rule both surfaces apply to a category's line.
  'lib/business-os/planCategoryLine.ts',
  // Credit deduction slice 11c — the admin per-account credit view. The route
  // and its wiring match the builder regex through their import path; the
  // block renders an allowance (listed voluntarily).
  'app/api/admin/business-os/credits/accounts/[accountId]/route.ts',
  'lib/business-os/credits/adminCreditPositionDeps.ts',
  'app/admin/users/components/CreditsBlock.tsx',
];

/** The builders whose output carries a credit allowance to a reader. */
const BUILDERS = [
  'describePlanOffer',
  'describeInviteOffer',
  'buildCustomerPlanView',
  'creditAllowanceForDisplay',
  'ownerCreditUsage',
];

/** Product source files (no tests, no config, no type declarations) under the folders that ship. */
function productFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(path);
      }
    }
  };
  for (const root of ['app', 'lib', 'components', 'hooks']) walk(root);
  // The config IS the source of the figures, so it is excluded by design (header).
  return files.filter((file) => !file.startsWith('lib/business-os/entitlements/config/'));
}

/**
 * The platform dictionary: every `plan.*` and `usage.*` string, and any other
 * string that talks about credits in any of the three languages.
 */
/**
 * Every `key: value` string entry in a dictionary source. The key may be single-
 * or double-quoted (QA-6b-E2: the dictionary already holds double-quoted keys,
 * and a figure behind one used to pass unseen); the value may be either, or a
 * template literal.
 */
function dictionaryEntries(source: string): Array<{ key: string; value: string }> {
  return [...source.matchAll(/^\s*(['"])([\w.-]+)\1:\s*(['"`])((?:\\.|(?!\3).)*)\3/gm)].map((match) => ({
    key: match[2],
    value: match[4],
  }));
}

function dictionaryStringsAboutCredits(): Array<{ key: string; value: string }> {
  const entries = dictionaryEntries(read('lib/business-os/LanguageContext.tsx'));
  return entries.filter(
    ({ key, value }) => key.startsWith('plan.') || key.startsWith('usage.') || /credit|קרדיט|crédito/i.test(value)
  );
}

describe('credit figures come only from configuration (user requirement, 2026-10-01)', () => {
  it('the figure list is real: the config holds the user-listed figures today', () => {
    // Non-vacuity. If the plans are re-priced this fails loudly, and the fix is to
    // update USER_LISTED — the guard still checks the new figures via CONFIGURED.
    for (const n of USER_LISTED) expect(CONFIGURED).toContain(n);
  });

  it('the pattern matches every way a figure could be typed (planted violations)', () => {
    for (const planted of [
      'Credits (19,750 per month)',
      "'{n} per month' // 32250",
      'const ALLOWANCE = 32_250;',
      '19.750 al mes',
      '2 000 en total',
      '2,000 credits',
      'קרדיטים (2000 בסך הכול)',
    ]) {
      expect(findFigures(planted).length).toBeGreaterThan(0);
    }
    // And does not fire on numbers that merely contain one.
    for (const clean of ['{n} per month', '120000', 'v2.0001', '1,2000', '$79 a month', '2026-10-01']) {
      expect(findFigures(clean)).toEqual([]);
    }
  });

  it('comment stripping keeps code and drops comments (planted)', () => {
    expect(stripComments('/* 19,750 */ const x = 1;')).not.toMatch(/19,750/);
    expect(stripComments('// 19,750\nconst x = 1;')).not.toMatch(/19,750/);
    expect(stripComments("const s = 'https://example.com'; // 32,250")).toContain('https://example.com');
    expect(stripComments("const s = 'https://example.com'; // 32,250")).not.toMatch(/32,250/);
    expect(stripComments("const s = '19,750 per month';")).toMatch(/19,750/);
  });

  it('every product file that calls a plan / credit display builder is listed in SOURCES', () => {
    const callers = productFiles().filter((file) => {
      const code = stripComments(read(file));
      return BUILDERS.some((name) => new RegExp(`\\b${name}\\b`).test(code));
    });
    // Non-vacuity: the walk really finds the surfaces this guard was written for.
    expect(callers).toEqual(
      expect.arrayContaining(['app/api/business-os/entitlements/my-plan/route.ts', 'lib/business-os/invites/publicInviteView.ts'])
    );
    expect(callers.filter((file) => !SOURCES.includes(file))).toEqual([]);
  });

  it('the dictionary scan reads single- and double-quoted keys alike (planted, QA-6b-E2)', () => {
    const planted = [
      `    'usage.single': 'Credits (19,750 per month)',`,
      `    "usage.double": "Credits (19,750 per month)",`,
      `    "usage.mixed": 'קרדיטים (32,250 לחודש)',`,
      '    "plan.template": `Créditos (19.750 al mes)`,',
    ].join('\n');
    const entries = dictionaryEntries(planted);

    expect(entries.map(({ key }) => key)).toEqual(['usage.single', 'usage.double', 'usage.mixed', 'plan.template']);
    for (const { value } of entries) expect(findFigures(value).length).toBeGreaterThan(0);
  });

  it.each(SOURCES)('%s contains no literal credit figure', (file) => {
    expect(findFigures(stripComments(read(file)))).toEqual([]);
  });

  it('no dictionary string about plans, usage or credits contains a figure — they are templates', () => {
    const strings = dictionaryStringsAboutCredits();
    // Non-vacuity: the scan really reaches the plan and usage copy in three languages.
    expect(strings.filter(({ key }) => key === 'plan.category.credits')).toHaveLength(3);
    // Slice 8a: `usage.of` is gone (SQ-47); the card's percentage label is the anchor now.
    expect(strings.filter(({ key }) => key === 'usage.sr.monthly')).toHaveLength(3);

    const offenders = strings.filter(({ value }) => findFigures(value).length > 0);
    expect(offenders).toEqual([]);
  });

  it('the usage templates take the number as a placeholder, never a value', () => {
    const strings = dictionaryStringsAboutCredits();
    // Slice 8a: the card shows a percentage; every template takes it as {percent}.
    for (const key of ['usage.less_than_percent', 'usage.sr.monthly', 'usage.sr.trial', 'usage.sr.plain']) {
      const entries = strings.filter((entry) => entry.key === key);
      expect(entries).toHaveLength(3);
      for (const { value } of entries) expect(value).toContain('{percent}');
    }
  });
});
