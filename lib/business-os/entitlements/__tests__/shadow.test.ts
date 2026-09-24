/**
 * The shadow path's one promise: **it cannot affect the request it observes.**
 *
 * Every test here is a way of trying to break that — a throwing config loader, a
 * throwing repository, a malformed plan — and asserting that the caller is
 * untouched and the failure is a log line.
 *
 * `jest.isolateModules` + `doMock` throughout, because the thing being tested is
 * what happens at IMPORT time as much as at call time (RC-7).
 */

import type { ShadowChatInput } from '@/lib/business-os/entitlements/shadow';

const MODE_ENV = 'BOS_ENTITLEMENTS_MODE';
const original = process.env[MODE_ENV];

afterEach(() => {
  if (original === undefined) delete process.env[MODE_ENV];
  else process.env[MODE_ENV] = original;
  jest.resetModules();
});

function setMode(value: string | undefined) {
  if (value === undefined) delete process.env[MODE_ENV];
  else process.env[MODE_ENV] = value;
}

/** A plan that needs two capabilities: a read and a write. */
const PLAN: ShadowChatInput['plan'] = {
  steps: [
    { id: 's1', op: 'find', entity: 'contacts' },
    { id: 's2', op: 'mutate', entity: 'invoices', action: 'mark_paid' },
  ],
};

/** Let the un-awaited promise inside `shadowChatPlan` run to completion. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  shadowChatPlan: (input: ShadowChatInput) => void;
  recorded: Array<Record<string, unknown>>;
  errors: Array<[unknown, string]>;
  infos: Array<[unknown, string]>;
  snapshotCalls: number;
  configCalls: number;
}

/**
 * Load `shadow.ts` with every collaborator mocked.
 *
 * `failures` chooses which one breaks, which is the whole point of the suite.
 */
function load(
  failures: {
    config?: boolean;
    snapshot?: boolean;
    record?: boolean;
    unavailable?: boolean;
    /** QA A-2: make the seam return something the raw id is not. */
    mapAccountId?: (userId: string) => string;
    onSnapshot?: (accountId: string) => void;
  } = {}
): Harness {
  const harness: Harness = {
    shadowChatPlan: () => undefined,
    recorded: [],
    errors: [],
    infos: [],
    snapshotCalls: 0,
    configCalls: 0,
  };

  jest.isolateModules(() => {
    jest.doMock('@/lib/logger', () => ({
      createLogger: () => ({
        error: (...args: unknown[]) => harness.errors.push([args[0], String(args[1])]),
        warn: (...args: unknown[]) => harness.infos.push([args[0], String(args[1])]),
        info: (...args: unknown[]) => harness.infos.push([args[0], String(args[1])]),
        debug: jest.fn(),
        child: jest.fn(),
      }),
    }));

    jest.doMock('@/lib/business-os/entitlements/source', () => ({
      getEntitlementConfig: () => {
        harness.configCalls += 1;
        if (failures.config) throw new Error('config is invalid');
        return jest.requireActual('@/lib/business-os/entitlements/source').readCodeConfig();
      },
    }));

    jest.doMock('@/lib/business-os/entitlements/EntitlementService', () => ({
      getEntitlementService: () => ({
        getSnapshot: async (accountId: string) => {
          harness.snapshotCalls += 1;
          failures.onSnapshot?.(accountId);
          if (failures.snapshot) throw new Error('database is down');
          if (failures.unavailable) return { resolution: null, unavailable: true, stale: false };

          const { resolveEntitlements } = jest.requireActual('@/lib/business-os/entitlements/resolver');
          const { readCodeConfig } = jest.requireActual('@/lib/business-os/entitlements/source');
          return {
            resolution: resolveEntitlements({
              config: readCodeConfig(),
              account: {
                accountId: 'acct-1',
                tier: null,
                planVersion: 0,
                tierExpiresAt: null,
                cohort: 'champion',
                cohortExpiresAt: null,
                onboardingStartedAt: null,
                profileCreatedAt: null,
                trialStartedAt: null,
                trialEndsAt: null,
                graceEndsAt: null,
              },
              overrides: [],
              addons: [],
              now: new Date('2026-09-22T00:00:00.000Z'),
            }),
            unavailable: false,
            stale: false,
          };
        },
      }),
    }));

    if (failures.mapAccountId) {
      jest.doMock('@/lib/business-os/entitlements/account', () => ({
        ...jest.requireActual('@/lib/business-os/entitlements/account'),
        resolveAccountId: failures.mapAccountId,
      }));
    }

    jest.doMock('@/lib/repositories/BusinessOsEntitlementShadowRepository', () => ({
      businessOsEntitlementShadowRepository: {
        recordEvents: async (rows: Array<Record<string, unknown>>) => {
          if (failures.record) throw new Error('rpc exploded');
          harness.recorded.push(...rows);
          return { data: rows.length, error: null };
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    harness.shadowChatPlan = require('@/lib/business-os/entitlements/shadow').shadowChatPlan;
  });

  return harness;
}

describe('mode `off` — the default, and what production runs', () => {
  it('does nothing at all: no config, no read, no write', async () => {
    setMode(undefined);
    const h = load();

    h.shadowChatPlan({ userId: 'acct-1', plan: PLAN });
    await settle();

    expect(h.configCalls).toBe(0);
    expect(h.snapshotCalls).toBe(0);
    expect(h.recorded).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it('does nothing even when every collaborator is broken', async () => {
    // The point of checking the flag FIRST: with it off, a config that cannot
    // load is not merely tolerated, it is never consulted.
    setMode('off');
    const h = load({ config: true, snapshot: true, record: true });

    expect(() => h.shadowChatPlan({ userId: 'acct-1', plan: PLAN })).not.toThrow();
    await settle();

    expect(h.configCalls).toBe(0);
    expect(h.errors).toEqual([]);
  });
});

describe('mode `shadow` — it records, and it still cannot break the turn', () => {
  it('records one row per capability, surface, outcome and rule', async () => {
    setMode('shadow');
    const h = load();

    h.shadowChatPlan({ userId: 'acct-1', plan: PLAN, correlationId: 'corr-1' });
    await settle();

    expect(h.recorded.length).toBeGreaterThan(0);
    for (const row of h.recorded) {
      expect(row).toMatchObject({ user_id: 'acct-1', sample_correlation_id: 'corr-1' });
      expect(typeof row.capability).toBe('string');
      expect(typeof row.outcome).toBe('string');
      expect(row.hits).toBeGreaterThan(0);
    }
  });

  it('records ALLOWED outcomes too (RC-6)', async () => {
    // A champion is entitled to everything, so today every row is `allowed`.
    // A denials-only recorder would write nothing at all and the first tier
    // would be designed on an empty table.
    setMode('shadow');
    const h = load();

    h.shadowChatPlan({ userId: 'acct-1', plan: PLAN });
    await settle();

    expect(h.recorded.some((row) => row.outcome === 'allowed')).toBe(true);
  });

  it('records a read under BOTH readings of the read rule (Q-B1)', async () => {
    setMode('shadow');
    const h = load();

    h.shadowChatPlan({ userId: 'acct-1', plan: { steps: [{ id: 's1', op: 'find', entity: 'contacts' }] } });
    await settle();

    const rules = h.recorded.map((row) => row.rule).sort();
    expect(rules).toEqual(['domain_group', 'read_only_plans_need_search']);
    // …and they disagree about which capability, which is the whole reason for
    // recording both.
    expect(new Set(h.recorded.map((row) => row.capability)).size).toBe(2);
  });

  it('a config that will not load is a log line, not an exception', async () => {
    setMode('shadow');
    const h = load({ config: true });

    expect(() => h.shadowChatPlan({ userId: 'acct-1', plan: PLAN })).not.toThrow();
    await settle();

    expect(h.recorded).toEqual([]);
    expect(h.errors.length).toBe(1);
    expect(h.errors[0][1]).toContain('Shadow recording failed');
  });

  it('a database failure is a log line, not an exception', async () => {
    setMode('shadow');
    const h = load({ snapshot: true });

    expect(() => h.shadowChatPlan({ userId: 'acct-1', plan: PLAN })).not.toThrow();
    await settle();

    expect(h.recorded).toEqual([]);
    expect(h.errors.length).toBe(1);
  });

  it('a throwing recorder is a log line, not an exception', async () => {
    setMode('shadow');
    const h = load({ record: true });

    expect(() => h.shadowChatPlan({ userId: 'acct-1', plan: PLAN })).not.toThrow();
    await settle();

    expect(h.errors.length).toBe(1);
  });

  it('unreadable inputs record nothing and say so, rather than recording a guess', async () => {
    setMode('shadow');
    const h = load({ unavailable: true });

    h.shadowChatPlan({ userId: 'acct-1', plan: PLAN });
    await settle();

    expect(h.recorded).toEqual([]);
    expect(h.infos.some(([, message]) => String(message).includes('unavailable'))).toBe(true);
  });

  it('an empty or unrecognisable plan records nothing and still does not throw', async () => {
    setMode('shadow');
    const h = load();

    expect(() => h.shadowChatPlan({ userId: 'acct-1', plan: { steps: [] } })).not.toThrow();
    await settle();
    expect(h.recorded).toEqual([]);

    expect(() =>
      h.shadowChatPlan({ userId: 'acct-1', plan: { steps: [{ op: 'find', entity: 'nonsense' }] } })
    ).not.toThrow();
    await settle();
    // An unmapped entity is an FR-8 defect and is logged at error — it is not
    // silently dropped, and it is not recorded as a capability either.
    expect(h.recorded).toEqual([]);
    expect(h.errors.some(([, message]) => String(message).includes('maps to no capability'))).toBe(true);
  });

  it('returns void, so no caller can await it by accident', () => {
    setMode('shadow');
    const h = load();
    expect(h.shadowChatPlan({ userId: 'acct-1', plan: PLAN })).toBeUndefined();
  });

  it('records against the id the SEAM returns, not the raw user id (QA A-2)', async () => {
    // R4-2's code landed without an assertion, and `AccountId` is a `string`
    // alias, so passing the raw id would type-check for ever. Making the seam
    // return something different is the only way to prove it is consulted.
    setMode('shadow');

    let seen: string | null = null;
    const h = load({ mapAccountId: (userId: string) => `account-for:${userId}`, onSnapshot: (id) => { seen = id; } });

    h.shadowChatPlan({ userId: 'user-1', plan: PLAN });
    await settle();

    expect(seen).toBe('account-for:user-1');
    expect(h.recorded.length).toBeGreaterThan(0);
    for (const row of h.recorded) expect(row.user_id).toBe('account-for:user-1');
  });
});

describe('the module itself (RC-7)', () => {
  it('imports only the logger and the mode flag at the top level', () => {
    // The property, asserted from the source: `shadow.ts` is on the chat route's
    // import path, so anything that could throw while loading — Zod, the config,
    // a repository — must be reached through `await import()` inside the try.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'shadow.ts'), 'utf8');

    const topLevelImports = source
      .split('\n')
      .filter((line: string) => /^import\s/.test(line))
      .join('\n');

    expect(topLevelImports).toMatch(/@\/lib\/logger/);
    expect(topLevelImports).toMatch(/'\.\/mode'/);
    expect(topLevelImports).not.toMatch(/'\.\/source'/);
    expect(topLevelImports).not.toMatch(/'\.\/schema'/);
    expect(topLevelImports).not.toMatch(/'\.\/config\//);
    expect(topLevelImports).not.toMatch(/repositories/);
    // Non-vacuity: the lazy imports really are there.
    expect(source).toMatch(/await Promise\.all\(\[\s*\n?\s*import\(/);
  });
});
