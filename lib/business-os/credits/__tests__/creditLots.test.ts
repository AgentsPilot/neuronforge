/**
 * creditLots — the one definition of "extra credits at a moment" (credit
 * deduction slice 11a, SA S11-SQ-4, OP-2; workplan §3.5, §7.2).
 *
 * Also the slice's source guards: the `<=` expiry rule is the same in this file
 * and in the reversal function (cross-file pin); neither new file imports the
 * entitlements module (G6); and nothing outside an exact allowed list names
 * the lot repository or this module (G3, SA W11a-7: searched by exported
 * symbol, so an import through the barrel is caught too). Slice 11b turned G3
 * from "no caller yet" into that exact list (OP-20, SA W11b-8).
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  creditLotRemaining,
  extraCreditsAt,
  isCreditLotExpired,
  type CreditLotForBalance,
} from '@/lib/business-os/credits/creditLots';

const AT = new Date('2026-10-15T12:00:00.000Z');

const lot = (overrides: Partial<CreditLotForBalance> = {}): CreditLotForBalance => ({
  id: 'lot-1',
  creditsGranted: 100,
  expiresAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  draws: [],
  ...overrides,
});

const reversal = (credits: number, createdAt = '2026-10-02T00:00:00.000Z') => ({ kind: 'reversal' as const, credits, createdAt });

describe('extraCreditsAt', () => {
  it('no lots: 0, and an empty list', () => {
    expect(extraCreditsAt([], AT)).toEqual({ extraCredits: 0, lots: [], hasInconsistentLot: false });
  });

  it('one lot with no draws counts in full', () => {
    expect(extraCreditsAt([lot()], AT)).toEqual({
      extraCredits: 100,
      lots: [{ id: 'lot-1', remaining: 100, expired: false }],
      hasInconsistentLot: false,
    });
  });

  it('fractional amounts are exact to 6 dp (no floating-point drift)', () => {
    const result = extraCreditsAt(
      [lot({ id: 'a', creditsGranted: 0.1 }), lot({ id: 'b', creditsGranted: 0.2 }), lot({ id: 'c', creditsGranted: 100.5, draws: [reversal(0.000001)] })],
      AT
    );
    expect(result?.extraCredits).toBe(100.799999);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(extraCreditsAt([lot({ id: 'a', creditsGranted: 0.1 }), lot({ id: 'b', creditsGranted: 0.2 })], AT)?.extraCredits).toBe(0.3);
  });

  it('a partial reversal reduces the lot; a full reversal leaves it at 0 and still listed', () => {
    const result = extraCreditsAt(
      [lot({ id: 'partial', draws: [reversal(40)] }), lot({ id: 'full', creditsGranted: 60.5, draws: [reversal(40), reversal(20.5)] })],
      AT
    );
    expect(result).toEqual({
      extraCredits: 60,
      lots: [
        { id: 'partial', remaining: 60, expired: false },
        { id: 'full', remaining: 0, expired: false },
      ],
      hasInconsistentLot: false,
    });
  });

  it('a lot created mid-period counts from its own createdAt, at once', () => {
    const midPeriod = lot({ id: 'mid', createdAt: '2026-10-15T11:59:59.999Z' });
    expect(extraCreditsAt([midPeriod], AT)?.extraCredits).toBe(100);
    expect(extraCreditsAt([lot({ id: 'exact', createdAt: AT.toISOString() })], AT)?.extraCredits).toBe(100);
  });

  it('a lot created after `at` did not exist yet: not counted and not listed (OP-2)', () => {
    const later = lot({ id: 'later', createdAt: '2026-10-15T12:00:00.001Z' });
    expect(extraCreditsAt([lot(), later], AT)).toEqual({
      extraCredits: 100,
      lots: [{ id: 'lot-1', remaining: 100, expired: false }],
      hasInconsistentLot: false,
    });
  });

  it('a draw made after `at` is ignored (OP-2)', () => {
    const result = extraCreditsAt([lot({ draws: [reversal(10), reversal(30, '2026-10-15T12:00:00.001Z')] })], AT);
    expect(result?.extraCredits).toBe(90);
  });

  it('expiry exactly at `at` is expired (<=); one millisecond later it still counts', () => {
    const atExpiry = lot({ id: 'at', expiresAt: AT.toISOString() });
    const justAfter = lot({ id: 'after', expiresAt: '2026-10-15T12:00:00.001Z' });
    const justBefore = lot({ id: 'before', expiresAt: '2026-10-15T11:59:59.999Z' });
    const result = extraCreditsAt([atExpiry, justAfter, justBefore], AT);
    expect(result?.extraCredits).toBe(100);
    expect(result?.lots).toEqual([
      { id: 'at', remaining: 100, expired: true },
      { id: 'after', remaining: 100, expired: false },
      { id: 'before', remaining: 100, expired: true },
    ]);
  });

  it('a lot with no expiry never expires', () => {
    expect(extraCreditsAt([lot({ expiresAt: null, createdAt: '2020-01-01T00:00:00Z' })], new Date('2099-01-01T00:00:00Z'))?.extraCredits).toBe(100);
  });

  it('a lot that drew more than it granted is clamped to 0 and reported, never subtracted from the others', () => {
    const result = extraCreditsAt([lot({ id: 'bad', creditsGranted: 10, draws: [reversal(15)] }), lot({ id: 'good' })], AT);
    expect(result).toEqual({
      extraCredits: 100,
      lots: [
        { id: 'bad', remaining: 0, expired: false },
        { id: 'good', remaining: 100, expired: false },
      ],
      hasInconsistentLot: true,
    });
  });

  it.each([
    ['a NaN grant', [lot({ creditsGranted: Number.NaN })]],
    ['an infinite draw', [lot({ draws: [reversal(Number.POSITIVE_INFINITY)] })]],
    ['an unreadable createdAt', [lot({ createdAt: 'yesterday' })]],
    ['an unreadable expiresAt', [lot({ expiresAt: 'soon' })]],
    ['an unreadable draw date', [lot({ draws: [reversal(1, 'later')] })]],
    ['a string figure', [lot({ creditsGranted: '100' as unknown as number })]],
  ])('%s gives no answer (null), never a guess', (_name, lots) => {
    expect(extraCreditsAt(lots, AT)).toBeNull();
  });

  it('an invalid `at` gives null', () => {
    expect(extraCreditsAt([lot()], new Date('not a date'))).toBeNull();
  });
});

describe('creditLotRemaining and isCreditLotExpired', () => {
  it('remaining is granted minus the draws up to `at`, unclamped', () => {
    expect(creditLotRemaining(lot({ draws: [reversal(40)] }), AT)).toBe(60);
    expect(creditLotRemaining(lot({ creditsGranted: 10, draws: [reversal(15)] }), AT)).toBe(-5);
    expect(creditLotRemaining(lot({ draws: [reversal(40, '2026-11-01T00:00:00Z')] }), AT)).toBe(100);
    expect(creditLotRemaining(lot({ creditsGranted: Number.NaN }), AT)).toBeNull();
  });

  it('expired means expiresAt <= at; no expiry never expires; an unreadable expiry counts as expired', () => {
    expect(isCreditLotExpired({ expiresAt: AT.toISOString() }, AT)).toBe(true);
    expect(isCreditLotExpired({ expiresAt: '2026-10-15T12:00:00.001Z' }, AT)).toBe(false);
    expect(isCreditLotExpired({ expiresAt: null }, AT)).toBe(false);
    expect(isCreditLotExpired({ expiresAt: 'garbage' }, AT)).toBe(true);
  });
});

describe('cross-file pin: the same <= in SQL and TypeScript', () => {
  const ROOT = process.cwd();
  it('the reversal function uses expires_at <= now() and creditLots.ts uses <=', () => {
    const migration = readFileSync(join(ROOT, 'supabase', 'migrations', '20261017_business_os_credit_lots.sql'), 'utf8');
    const core = readFileSync(join(ROOT, 'lib', 'business-os', 'credits', 'creditLots.ts'), 'utf8');
    expect(migration).toContain('lot_row.expires_at <= now()');
    expect(core).toContain('return expiresMs <= atMs;');
    expect(core).not.toMatch(/expiresMs < atMs/);
  });
});

describe('source guards (G3, G6, W11a-7)', () => {
  const ROOT = process.cwd();
  const NEW_FILES = ['lib/business-os/credits/creditLots.ts', 'lib/repositories/BusinessOsCreditLotRepository.ts'];

  it.each(NEW_FILES)('%s imports nothing from the entitlements module (and creditLots.ts imports nothing at all)', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).not.toMatch(/business-os\/entitlements/);
    expect(source).not.toMatch(/from ['"]\.\.?\/.*entitlements/);
    if (file.endsWith('creditLots.ts')) {
      expect(source).not.toMatch(/^\s*import\s/m);
    }
  });

  const SCANNED = ['app', 'lib', 'components', 'hooks', 'scripts', 'pages', 'middleware.ts'];
  const SYMBOLS = [
    'BusinessOsCreditLotRepository',
    'businessOsCreditLotRepository',
    'BOS_RECORD_CREDIT_LOT_RPC',
    'BOS_REVERSE_CREDIT_LOT_RPC',
    'business_os_record_credit_lot',
    'business_os_reverse_credit_lot',
    'credits/creditLots',
    'extraCreditsAt',
    'creditLotRemaining',
    'isCreditLotExpired',
  ];
  /**
   * EXACTLY these files may name the lot repository or the balance core: the
   * two 11a files, the barrel (the one permitted re-export, not a caller:
   * W11a-7), the 11b admin credit ops, the accounts route that wires the
   * repository in, and their tests (SA W11b-8). `adminOps.ts` is deliberately
   * absent: it takes the repository's type through `creditAdminOps.ts`'s
   * exported context type, so it names none of the symbols. A new caller is
   * added here, in a reviewable diff, or this test fails.
   */
  const BARREL = 'lib/repositories/index.ts';
  const ALLOWED_LIST = [
    'lib/business-os/credits/creditLots.ts',
    'lib/business-os/credits/__tests__/creditLots.test.ts',
    'lib/repositories/BusinessOsCreditLotRepository.ts',
    'lib/repositories/__tests__/BusinessOsCreditLotRepository.test.ts',
    BARREL,
    // Slice 11b.
    'lib/business-os/credits/creditAdminOps.ts',
    'lib/business-os/credits/__tests__/creditAdminOps.test.ts',
    'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts',
    'app/api/admin/business-os/entitlements/__tests__/routes.test.ts',
  ];
  const ALLOWED = new Set(ALLOWED_LIST.map((p) => p.split('/').join(sep)));

  function walk(path: string, out: string[] = []): string[] {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return out;
    }
    if (stats.isFile()) {
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) out.push(path);
      return out;
    }
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
      walk(join(path, entry), out);
    }
    return out;
  }

  const files = SCANNED.flatMap((dir) => walk(join(ROOT, dir)));

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(SYMBOLS)('nothing outside the exact allowed list names %s', (symbol) => {
    const referrers = files
      .filter((file) => readFileSync(file, 'utf8').includes(symbol))
      .map((file) => relative(ROOT, file))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();
    expect(referrers).toEqual([]);
  });

  it('non-vacuity (W11b-8): every non-barrel, non-test entry of the list really names a symbol, so a stale entry fails', () => {
    const callers = ALLOWED_LIST.filter((p) => p !== BARREL && !p.includes('/__tests__/'));
    expect(callers.length).toBeGreaterThan(0);
    const stale = callers.filter((p) => {
      const source = readFileSync(join(ROOT, ...p.split('/')), 'utf8');
      return !SYMBOLS.some((symbol) => source.includes(symbol));
    });
    expect(stale).toEqual([]);
  });

  it('adminOps.ts names none of the symbols (it goes through creditAdminOps.ts)', () => {
    const source = readFileSync(join(ROOT, 'lib', 'business-os', 'entitlements', 'adminOps.ts'), 'utf8');
    expect(SYMBOLS.filter((symbol) => source.includes(symbol))).toEqual([]);
  });

  it('the barrel only re-exports the repository and does not export creditLots', () => {
    const barrel = readFileSync(join(ROOT, 'lib', 'repositories', 'index.ts'), 'utf8');
    expect(barrel).toContain("from './BusinessOsCreditLotRepository';");
    expect(barrel).not.toMatch(/creditLots/);
  });
});
