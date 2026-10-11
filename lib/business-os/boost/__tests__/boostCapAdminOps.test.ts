/**
 * The admin cap override ops (credits boost slice 6b; FR-22; SA C-1, C-2, C-3).
 *
 * `executeBoostCapAdminOp` against a fake repository following 2a's functions,
 * and the two body schemas with the configured bounds. The shared pre-checks
 * (own account, platform account, tenant, plan row) are pinned through
 * `executeAdminOp` in `entitlements/__tests__/adminOps.test.ts`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BOOST_CAP_ADMIN_OP_NAMES,
  endBoostCapSchema,
  executeBoostCapAdminOp,
  isBoostCapAdminOp,
  refuseBoostCapOpForPlatformAccount,
  setBoostCapSchema,
  type BoostCapAdminOp,
  type BoostCapAdminOpContext,
} from '@/lib/business-os/boost/boostCapAdminOps';
import { BOOST_PURCHASE_CAP_DEFAULT, BOOST_PURCHASE_CAP_OVERRIDE_BOUNDS } from '@/lib/business-os/entitlements/config/boostPackages';
import { BoostRepositoryFailure } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const ACTIVE = '33333333-3333-4333-8333-333333333333';
const NEW = '44444444-4444-4444-8444-444444444444';

function fakeRepository(state: { active: { id: string; capMinor: number } | null; readFails?: boolean; writeFails?: boolean; noPlanRow?: boolean }) {
  const calls: string[] = [];
  const repository = {
    findActiveCapOverride: jest.fn(async () => {
      calls.push('findActiveCapOverride');
      if (state.readFails) return { data: null, error: new BoostRepositoryFailure('down', '57014', false) };
      return {
        data: state.active
          ? { id: state.active.id, accountId: ACCOUNT, capMinor: state.active.capMinor, currency: 'USD', reason: 'earlier', actorAdminId: ADMIN, createdAt: '2026-10-01T00:00:00.000Z' }
          : null,
        error: null,
      };
    }),
    setCapOverride: jest.fn(async (input: { capMinor: number }) => {
      calls.push('setCapOverride');
      if (state.writeFails) return { data: null, error: new BoostRepositoryFailure('down', '57014', false) };
      if (state.noPlanRow) return { data: { outcome: 'no_plan_row' as const }, error: null };
      const previous = state.active?.id ?? null;
      state.active = { id: NEW, capMinor: input.capMinor };
      return { data: { outcome: 'set' as const, overrideId: NEW, previousOverrideId: previous }, error: null };
    }),
    endCapOverride: jest.fn(async () => {
      calls.push('endCapOverride');
      if (state.writeFails) return { data: null, error: new BoostRepositoryFailure('down', '57014', false) };
      if (!state.active) return { data: { outcome: 'none_active' as const }, error: null };
      const id = state.active.id;
      state.active = null;
      return { data: { outcome: 'ended' as const, overrideId: id }, error: null };
    }),
  };
  return { repository, calls, state };
}

function context(repository: BoostCapAdminOpContext['repository']): BoostCapAdminOpContext {
  return { accountId: ACCOUNT, adminId: ADMIN, bounds: BOOST_PURCHASE_CAP_OVERRIDE_BOUNDS, defaultCap: BOOST_PURCHASE_CAP_DEFAULT, repository };
}

const set = (amountMinor: number, reason = 'annual prepay customer'): BoostCapAdminOp => ({ op: 'set_boost_cap', amountMinor, reason });
const end = (reason = 'campaign over'): BoostCapAdminOp => ({ op: 'end_boost_cap', reason });

describe('the configured bounds (BQ-1, SA C-3)', () => {
  it('are $1 to $1,500 in whole dollars, beside the $150 / 30 days default', () => {
    expect(BOOST_PURCHASE_CAP_OVERRIDE_BOUNDS).toEqual({ minMinor: 100, maxMinor: 150000, stepMinor: 100, currency: 'USD' });
    expect(BOOST_PURCHASE_CAP_DEFAULT).toEqual({ amountMinor: 15000, currency: 'USD', windowDays: 30 });
  });

  it('the ops file holds no figure of its own (the bounds are passed in)', () => {
    const code = readFileSync(join(process.cwd(), 'lib/business-os/boost/boostCapAdminOps.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/150000|15000\b/);
  });
});

describe('the body schemas', () => {
  const schema = setBoostCapSchema(BOOST_PURCHASE_CAP_OVERRIDE_BOUNDS);

  it.each([
    ['$1 (the floor)', 100],
    ['$500', 50000],
    ['$1,500 (the ceiling)', 150000],
  ])('accepts %s', (_name, amountMinor) => {
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor, reason: 'support case' }).success).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['a fraction of a dollar', 15050],
    ['a fraction of a cent', 100.5],
    ['above the ceiling', 150100],
    ['a string', '50000'],
    ['NaN', Number.NaN],
  ])('refuses %s', (_name, amountMinor) => {
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor, reason: 'support case' }).success).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['too short', 'ab'],
    ['only spaces', '      '],
    ['too long', 'x'.repeat(501)],
  ])('a reason %s is refused, for set and end', (_name, reason) => {
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor: 50000, reason }).success).toBe(false);
    expect(endBoostCapSchema.safeParse({ op: 'end_boost_cap', reason }).success).toBe(false);
  });

  it('unknown keys are refused (strict): no account id, no currency, no window', () => {
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor: 50000, reason: 'support case', accountId: ACCOUNT }).success).toBe(false);
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor: 50000, reason: 'support case', currency: 'EUR' }).success).toBe(false);
    expect(endBoostCapSchema.safeParse({ op: 'end_boost_cap', reason: 'support case', windowDays: 7 }).success).toBe(false);
  });

  it('QA6b-L1: the length is in code points, as char_length(btrim(reason)) counts it', () => {
    const smile = '\u{1F600}';
    // Two emoji are 4 UTF-16 units but 2 characters for the SQL: refused here, before the database.
    expect(endBoostCapSchema.safeParse({ op: 'end_boost_cap', reason: smile.repeat(2) }).success).toBe(false);
    expect(endBoostCapSchema.safeParse({ op: 'end_boost_cap', reason: smile.repeat(3) }).success).toBe(true);
    // 500 emoji are 1,000 UTF-16 units but 500 characters: accepted, as the SQL accepts them.
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor: 50000, reason: smile.repeat(500) }).success).toBe(true);
    expect(schema.safeParse({ op: 'set_boost_cap', amountMinor: 50000, reason: smile.repeat(501) }).success).toBe(false);
  });

  it('the reason is trimmed', () => {
    const parsed = endBoostCapSchema.parse({ op: 'end_boost_cap', reason: '  campaign over  ' });
    expect(parsed.reason).toBe('campaign over');
  });

  it('names and the platform refusal (SA C-1)', () => {
    expect(BOOST_CAP_ADMIN_OP_NAMES).toEqual(['set_boost_cap', 'end_boost_cap']);
    expect(isBoostCapAdminOp({ op: 'set_boost_cap' })).toBe(true);
    expect(isBoostCapAdminOp({ op: 'grant_credits' })).toBe(false);
    expect(refuseBoostCapOpForPlatformAccount(ACCOUNT)).toBeNull();
    expect(refuseBoostCapOpForPlatformAccount('00000000-0000-0000-0000-000000000000')).toEqual({ ok: false, status: 409, error: 'platform_account' });
  });
});

describe('set_boost_cap', () => {
  it('from the default: writes once with the admin and the reason; the audit names the limit before and after on the account plan', async () => {
    const { repository } = fakeRepository({ active: null });
    const result = await executeBoostCapAdminOp(set(50000), context(repository));
    expect(repository.setCapOverride).toHaveBeenCalledWith({ accountId: ACCOUNT, capMinor: 50000, currency: 'USD', reason: 'annual prepay customer', actorAdminId: ADMIN });
    expect(result).toEqual({
      ok: true,
      action: 'BOS_BOOST_CAP_OVERRIDE_SET',
      data: { overrideId: NEW, previousOverrideId: null, amountMinor: 50000 },
      audit: {
        entityType: 'business_os_account_plan',
        entityId: ACCOUNT,
        changes: { before: { capMinor: 15000, source: 'default' }, after: { capMinor: 50000, source: 'override' } },
        details: { window_days: 30, currency: 'USD', default_cap_minor: 15000, override_id: NEW, previous_override_id: null },
      },
    });
  });

  it('replacing an override: before is the old override, the previous id is recorded', async () => {
    const { repository } = fakeRepository({ active: { id: ACTIVE, capMinor: 30000 } });
    const result = await executeBoostCapAdminOp(set(50000), context(repository));
    expect(result).toMatchObject({
      ok: true,
      data: { previousOverrideId: ACTIVE },
      audit: { changes: { before: { capMinor: 30000, source: 'override' } }, details: { previous_override_id: ACTIVE } },
    });
  });

  it('SA C-2: the SAME amount already active → unchanged, NO write and NO audit', async () => {
    const { repository } = fakeRepository({ active: { id: ACTIVE, capMinor: 50000 } });
    const result = await executeBoostCapAdminOp(set(50000), context(repository));
    expect(result).toEqual({ ok: true, action: 'BOS_BOOST_CAP_OVERRIDE_SET', unchanged: true, data: { unchanged: true, amountMinor: 50000, overrideId: ACTIVE } });
    expect(repository.setCapOverride).not.toHaveBeenCalled();
  });

  it('a double submit: the second is a no-op (one write, one audit)', async () => {
    const { repository } = fakeRepository({ active: null });
    const first = await executeBoostCapAdminOp(set(50000), context(repository));
    const second = await executeBoostCapAdminOp(set(50000), context(repository));
    expect(repository.setCapOverride).toHaveBeenCalledTimes(1);
    expect(first).toHaveProperty('audit');
    expect(second).not.toHaveProperty('audit');
  });

  it('setting the default figure as an override is a real change (an override exists from then on)', async () => {
    const { repository } = fakeRepository({ active: null });
    const result = await executeBoostCapAdminOp(set(15000), context(repository));
    expect(result).toMatchObject({ ok: true, audit: { changes: { before: { source: 'default' }, after: { capMinor: 15000, source: 'override' } } } });
  });

  it('the read failing → 500, nothing written; the write failing → 500; no plan row → 409', async () => {
    const readFails = fakeRepository({ active: null, readFails: true });
    expect(await executeBoostCapAdminOp(set(50000), context(readFails.repository))).toEqual({ ok: false, status: 500, error: 'cap_override_read_failed' });
    expect(readFails.repository.setCapOverride).not.toHaveBeenCalled();

    expect(await executeBoostCapAdminOp(set(50000), context(fakeRepository({ active: null, writeFails: true }).repository))).toEqual({
      ok: false,
      status: 500,
      error: 'cap_override_write_failed',
    });
    expect(await executeBoostCapAdminOp(set(50000), context(fakeRepository({ active: null, noPlanRow: true }).repository))).toEqual({
      ok: false,
      status: 409,
      error: 'plan_row_missing',
    });
  });
});

describe('end_boost_cap', () => {
  it('ends the active override; the audit says back to the default', async () => {
    const { repository } = fakeRepository({ active: { id: ACTIVE, capMinor: 50000 } });
    const result = await executeBoostCapAdminOp(end(), context(repository));
    expect(repository.endCapOverride).toHaveBeenCalledWith({ accountId: ACCOUNT, actorAdminId: ADMIN, reason: 'campaign over' });
    expect(result).toEqual({
      ok: true,
      action: 'BOS_BOOST_CAP_OVERRIDE_ENDED',
      data: { overrideId: ACTIVE },
      audit: {
        entityType: 'business_os_account_plan',
        entityId: ACCOUNT,
        changes: { before: { capMinor: 50000, source: 'override' }, after: { capMinor: 15000, source: 'default' } },
        details: { window_days: 30, currency: 'USD', default_cap_minor: 15000, override_id: ACTIVE },
      },
    });
  });

  it('no active override, or a repeated end → 409 no_active_cap_override, no audit', async () => {
    const { repository } = fakeRepository({ active: { id: ACTIVE, capMinor: 50000 } });
    await executeBoostCapAdminOp(end(), context(repository));
    expect(await executeBoostCapAdminOp(end(), context(repository))).toEqual({ ok: false, status: 409, error: 'no_active_cap_override' });
  });

  it('a write failure → 500', async () => {
    expect(await executeBoostCapAdminOp(end(), context(fakeRepository({ active: { id: ACTIVE, capMinor: 1 }, writeFails: true }).repository))).toEqual({
      ok: false,
      status: 500,
      error: 'cap_override_write_failed',
    });
  });
});

describe('source guards', () => {
  const code = readFileSync(join(process.cwd(), 'lib/business-os/boost/boostCapAdminOps.ts'), 'utf8');

  it('imports nothing from the entitlements module, type-only included (the one-way rule, as 11b)', () => {
    expect(code).not.toMatch(/(?:from|import|require\()\s*['"][^'"]*business-os\/entitlements/);
  });

  it('writes only through the two 2a functions, never a lot, a plan row or a table', () => {
    expect(code).not.toMatch(/supabase|\.from\(|\.rpc\(|credit_lots|recordLot|reverseLot|updatePlan/);
  });

  it('every action literal is a registered audit event', async () => {
    const { AUDIT_EVENTS } = await import('@/lib/audit/events');
    const actions = [...code.matchAll(/'(BOS_BOOST_CAP_OVERRIDE_[A-Z_]+)'/g)].map((m) => m[1]);
    expect(new Set(actions)).toEqual(new Set(['BOS_BOOST_CAP_OVERRIDE_SET', 'BOS_BOOST_CAP_OVERRIDE_ENDED']));
    for (const action of actions) expect(action in AUDIT_EVENTS).toBe(true);
  });
});
