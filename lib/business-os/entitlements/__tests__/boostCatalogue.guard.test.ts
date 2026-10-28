/**
 * Business OS credits boost, slice 1: source guards for the price rule and the
 * package catalogue (workplan §6.3, SA conditions C-1, C-4).
 *
 * - T-B9  No credit figure or base rate is typed in the new product files.
 *         Money in minor units (`priceMinor:` / `amountMinor:` values) is a
 *         typed input by design and is skipped (SA C-1).
 * - T-B10 The two config files are data only (no run-time imports, RC-7).
 * - T-B12 Every package in the config matches its released record in
 *         `boostPackages.snapshot.json`, and that snapshot is append-only (C-4).
 * - T-B13 Importing the catalogue never validates and never throws (RC-7).
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BOOST_PACKAGES, BOOST_PURCHASE_CAP_DEFAULT } from '@/lib/business-os/entitlements/config/boostPackages';
import { BoostCatalogueInvalidError, validateBoostCatalogue, type BoostPackage } from '@/lib/business-os/entitlements/boostCatalogue';
import { currentRetailRate } from '@/lib/business-os/entitlements/retailRate';

const MODULE_DIR = join('lib', 'business-os', 'entitlements');
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

// ── T-B9: no typed figures ───────────────────────────────────────────────────

const SCANNED = [
  `${MODULE_DIR}/config/boostPackages.ts`,
  `${MODULE_DIR}/config/creditRetail.ts`,
  `${MODULE_DIR}/retailRate.ts`,
  `${MODULE_DIR}/boostCatalogue.ts`,
].map((file) => file.split('\\').join('/'));

/** The base rate and every credit figure the shipped catalogue derives. */
function bannedFigures(): number[] {
  const rate = currentRetailRate();
  if (!rate.ok) throw new Error(rate.issue);
  const result = validateBoostCatalogue(BOOST_PACKAGES, rate, BOOST_PURCHASE_CAP_DEFAULT);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  const credits = result.packages.flatMap((pkg) => [pkg.baseCredits, pkg.bonusCredits, pkg.totalCredits]);
  return [...new Set([rate.rate.creditsPerUsd, ...credits].filter((n) => n >= 100))];
}

/** `5000`, `5,000`, `5.000`, `5 000`, `5_000`; never part of a longer number. */
function figurePattern(n: number): RegExp {
  const digits = String(n);
  const head = digits.slice(0, Math.max(0, digits.length - 3));
  const tail = digits.slice(-3);
  const sep = head ? '[,.\\s\\u00a0\\u202f_]?' : '';
  return new RegExp(`(?<![\\d.,_])${head}${sep}${tail}(?![\\d_])`);
}

/** Block comments, whole-line `//` comments and trailing ` // …` comments. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');
}

/** SA C-1: a price or cap in minor units is a typed input, not a credit figure. */
function maskMinorUnitValues(source: string): string {
  return source.replace(/\b(priceMinor|amountMinor)(\s*:\s*)[\d_,.]+/g, '$1$2<minor>');
}

function findFigures(source: string, figures: readonly number[]): string[] {
  const code = maskMinorUnitValues(stripComments(source));
  return figures.filter((n) => figurePattern(n).test(code)).map(String);
}

describe('no credit figure or base rate is typed in product code (T-B9, SA C-1)', () => {
  const figures = bannedFigures();

  it('the banned list is real: the rate and the Option A credits', () => {
    // Retail version 2 (decision D5, 2026-10-25): 200 per $1; Starter 2,000,
    // Plus 5,000 + 500, Max 10,000 + 1,500. Version 1's figures (500 per $1,
    // 5,000 / 13,750 / 28,750) are no longer derived, so no longer scanned for.
    expect(figures).toEqual(expect.arrayContaining([200, 2000, 5000, 500, 5500, 10000, 1500, 11500]));
  });

  it('catches every way a figure could be typed (planted)', () => {
    for (const planted of ['const RATE = 200;', 'baseCredits: 2000,', "label: '5,500 credits'", 'total = 11_500', '10 000']) {
      expect(findFigures(planted, figures).length).toBeGreaterThan(0);
    }
  });

  it('skips minor-unit money and comments, but nothing else (negative control, C-1)', () => {
    expect(findFigures('priceMinor: 5000,', figures)).toEqual([]);
    expect(findFigures('amountMinor: 15000,', figures)).toEqual([]);
    expect(findFigures('baseCredits: 5000,', figures)).toEqual(['5000']);
    expect(findFigures('priceMinor: 5000, totalCredits: 11500', figures)).toEqual(['11500']);
    expect(findFigures('// 200 credits per dollar\nconst x = 1;', figures)).toEqual([]);
    expect(findFigures('const x = 15000; const y = 1e-9; const z = 2026;', figures)).toEqual([]);
  });

  it.each(SCANNED)('%s contains no credit figure', (file) => {
    expect(findFigures(read(file), figures)).toEqual([]);
  });
});

// ── T-B10: config files are data only ────────────────────────────────────────

describe('the config files stay data only (T-B10, RC-7)', () => {
  it.each([`${MODULE_DIR}/config/creditRetail.ts`, `${MODULE_DIR}/config/boostPackages.ts`])(
    '%s imports nothing at run time',
    (file) => {
      const valueImports = read(file)
        .split('\n')
        .filter((line) => /^\s*import\s/.test(line) && !/^\s*import\s+type\s/.test(line));
      expect(valueImports).toEqual([]);
    }
  );
});

// ── T-B12: the released snapshot ─────────────────────────────────────────────

type SnapshotRecord = BoostPackage;

const SNAPSHOT = JSON.parse(read(`${MODULE_DIR}/config/boostPackages.snapshot.json`)) as SnapshotRecord[];

/**
 * Every released `(id, version)` and the fingerprint of its record. APPEND-ONLY:
 * a new package version adds a line (and a record in the snapshot) in the same
 * PR; an existing line is never edited or removed, even after the package goes
 * inactive or its version leaves the config (SA C-4, FR-4).
 */
const RELEASED: Readonly<Record<string, string>> = {
  'starter@1': '63ebcbc272529d2e',
  'plus@1': 'cc2cb9d83252f317',
  'max@1': '130f4d9780c7e035',
  // Credits re-size, 2026-10-25 (decision D5): retail version 2, same prices and bonuses.
  'starter@2': 'bcae417f6cc5c42b',
  'plus@2': '2e026363e3c2236d',
  'max@2': '2e37ff2229cabaec',
  /*
   * Labels translated, 2026-10-27. Same prices, bonuses and retail version.
   *
   * The names and descriptions were built with a helper that copied the
   * English string into the `he` and `es` slots. That satisfied the schema,
   * which only requires all three to be present, so every check passed and a
   * Hebrew or Spanish owner read English in the boost drawer.
   */
  'starter@3': '9f3113c256bad459',
  'plus@3': '6679b42c30e9ce39',
  'max@3': '7009c4d8d64f3707',
  /*
   * Renamed to sizes, 2026-10-27. Same prices, bonuses and retail version.
   *
   * Starter / Plus / Max is tier language: it says there is a ladder without
   * saying what is on it. Small / medium / large needs no explaining, and the
   * `id`s are untouched, so nothing stored against a purchase moves.
   */
  'starter@4': '544faaf2a9b184a8',
  'plus@4': '15eac7ce2cfe63e7',
  'max@4': '862f5efb35c62394',
};

/** JSON with sorted keys at every level, so the fingerprint ignores key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const fingerprint = (record: unknown) => createHash('sha256').update(canonical(record)).digest('hex').slice(0, 16);
const keyOf = (record: { id: string; version: number }) => `${record.id}@${record.version}`;

/** Released records that are missing from, or changed in, a snapshot. */
function snapshotViolations(released: Readonly<Record<string, string>>, snapshot: readonly SnapshotRecord[]): string[] {
  const byKey = new Map(snapshot.map((record) => [keyOf(record), record]));
  return Object.entries(released)
    .filter(([key, print]) => {
      const record = byKey.get(key);
      return record === undefined || fingerprint(record) !== print;
    })
    .map(([key]) => key);
}

/** Config packages whose resolved form differs from (or is absent in) the snapshot. */
function configDrift(resolved: readonly BoostPackage[], snapshot: readonly SnapshotRecord[]): string[] {
  const byKey = new Map(snapshot.map((record) => [keyOf(record), record]));
  return resolved
    .filter((pkg) => {
      const record = byKey.get(keyOf(pkg));
      return record === undefined || canonical(record) !== canonical(pkg);
    })
    .map(keyOf);
}

function resolvedShipped(): BoostPackage[] {
  const rate = currentRetailRate();
  const result = validateBoostCatalogue(BOOST_PACKAGES, rate, BOOST_PURCHASE_CAP_DEFAULT);
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return result.packages;
}

describe('the released package snapshot (T-B12, SA C-4, FR-4)', () => {
  it('every package in the config matches its released record exactly', () => {
    // Fails when a package changes without a version bump. Fix: bump `version`,
    // append the new resolved record and a RELEASED line; never edit an old one.
    expect(configDrift(resolvedShipped(), SNAPSHOT)).toEqual([]);
  });

  it('no released record has been removed or edited (append-only)', () => {
    expect(snapshotViolations(RELEASED, SNAPSHOT)).toEqual([]);
  });

  it('every record in the snapshot is released, once', () => {
    const keys = SNAPSHOT.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(RELEASED).sort());
  });

  it('versions of each package run 1, 2, 3 … with no gap', () => {
    const versions = new Map<string, number[]>();
    for (const record of SNAPSHOT) versions.set(record.id, [...(versions.get(record.id) ?? []), record.version]);
    for (const list of versions.values()) {
      expect([...list].sort((a, b) => a - b)).toEqual(list.map((_v, i) => i + 1));
    }
  });

  it('negative controls: an edit without a bump, an edited record and a removed record are all caught (T-F18)', () => {
    const shipped = resolvedShipped();
    const editedConfig = shipped.map((pkg) => (pkg.id === 'plus' ? { ...pkg, bonusPercent: 12 } : pkg));
    // The shipped config is version 4 since the 2026-10-27 rename to sizes.
    expect(configDrift(editedConfig, SNAPSHOT)).toEqual(['plus@4']);

    // Aimed at a version-1 record: a superseded release is protected exactly like the current one.
    const editedSnapshot = SNAPSHOT.map((record) =>
      record.id === 'max' && record.version === 1 ? { ...record, totalCredits: 1 } : record
    );
    expect(snapshotViolations(RELEASED, editedSnapshot)).toEqual(['max@1']);

    const removed = SNAPSHOT.filter((record) => !(record.id === 'starter' && record.version === 1));
    expect(snapshotViolations(RELEASED, removed)).toEqual(['starter@1']);
  });
});

// ── T-B13: lazy ──────────────────────────────────────────────────────────────

describe('importing the catalogue never validates (T-B13, RC-7)', () => {
  it('a broken catalogue imports cleanly and rejects only when read', async () => {
    const loaded: { listActive?: () => Promise<unknown>; ErrorClass?: typeof BoostCatalogueInvalidError } = {};
    jest.isolateModules(() => {
      jest.doMock('@/lib/business-os/entitlements/config/boostPackages', () => ({
        BOOST_PACKAGES: [{ id: 'broken' }],
        BOOST_PURCHASE_CAP_DEFAULT: { amountMinor: 15000, currency: 'USD', windowDays: 30 },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous require
      const mod = require('@/lib/business-os/entitlements/boostCatalogue') as typeof import('@/lib/business-os/entitlements/boostCatalogue');
      const source = mod.codeBoostPackageSource();
      loaded.ErrorClass = mod.BoostCatalogueInvalidError;
      loaded.listActive = () => source.listActive();
    });
    jest.dontMock('@/lib/business-os/entitlements/config/boostPackages');
    expect(loaded.listActive).toBeDefined();
    expect(loaded.ErrorClass).toBeDefined();
    if (!loaded.listActive || !loaded.ErrorClass) return;
    await expect(loaded.listActive()).rejects.toBeInstanceOf(loaded.ErrorClass);
  });
});
