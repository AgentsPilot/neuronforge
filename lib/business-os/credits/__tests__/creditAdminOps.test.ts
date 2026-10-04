/**
 * creditAdminOps — admin give / take back credits (credit deduction slice 11b;
 * workplan §11b.6.1, SA W11b-2 / -4 / -9 / -10).
 *
 * The executor is tested on its own, with an injected lot repository and hold
 * readers, so every branch is reached without a database. The shared checks
 * (own account, tenant, plan row) live in `adminOps.ts` and are tested there.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  ADMIN_CREDIT_GRANT_CEILING,
  CREDIT_ADMIN_OP_NAMES,
  CREDIT_REASON_MAX,
  CREDIT_REASON_MIN,
  executeCreditAdminOp,
  grantCreditsSchema,
  isCreditAdminOp,
  reduceCreditLotSchema,
  refuseCreditOpForPlatformAccount,
  type CreditAdminOp,
  type CreditAdminOpContext,
  type CreditLotRepositoryPort,
} from '@/lib/business-os/credits/creditAdminOps';
import type { CreditLotForBalance } from '@/lib/business-os/credits/creditLots';
import type {
  BusinessOsCreditLotReverseResult,
  BusinessOsCreditLotRow,
} from '@/lib/repositories/BusinessOsCreditLotRepository';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
// Hex letters on purpose: an all-digit uuid reads the same in upper case, so
// a case test written with one would prove nothing (W11b-2).
const LOT = 'aaaaaaaa-3333-4333-8333-33333333333a';
const BOOST_LOT = 'bbbbbbbb-4444-4444-8444-44444444444b';
const FOREIGN_LOT = 'ffffffff-5555-4555-8555-55555555555f';
const NEW_LOT = '66666666-6666-4666-8666-666666666666';
const DRAW = '77777777-7777-4777-8777-777777777777';
const REQUEST = 'ABCDEF12-3456-4789-8abc-def012345678';
const NOW = new Date('2026-10-02T12:00:00.000Z');

function lotRow(overrides: Partial<BusinessOsCreditLotRow> = {}): BusinessOsCreditLotRow {
  return {
    id: LOT,
    accountId: ACCOUNT,
    source: 'admin_grant',
    creditsGranted: 100,
    creditsBase: 100,
    creditsBonus: 0,
    creditValueVersion: 1,
    expiresAt: null,
    idempotencyKey: 'admin_grant:00000000-0000-4000-8000-000000000001',
    sourceRef: null,
    actorKind: 'admin',
    actorAdminId: ADMIN,
    reason: 'earlier grant',
    createdAt: '2026-09-01T00:00:00.000Z',
    draws: [],
    ...overrides,
  };
}

// QA11a-3: a repository row IS a balance lot. ts-jest does not type-check here,
// so the scoped `tsc` run is the gate for this line.
const assignable: CreditLotForBalance = lotRow();
void assignable;

interface Calls {
  recordLot: Array<Record<string, unknown>>;
  reverseLot: Array<Record<string, unknown>>;
  listLotsWithDraws: string[];
  findLotForAccount: unknown[][];
  lineage: string[];
  invites: string[];
}

type HoldMode = 'not_held' | 'held' | 'lineage_error' | 'throws';

function context(options: {
  lots?: BusinessOsCreditLotRow[];
  listError?: boolean;
  hold?: HoldMode;
  record?: { outcome: 'recorded' | 'replayed' | 'idempotency_key_conflict'; lotId?: string } | 'error';
  storedLot?: BusinessOsCreditLotRow | null | 'error';
  reverse?: BusinessOsCreditLotReverseResult | 'error';
} = {}): { ctx: CreditAdminOpContext; calls: Calls } {
  const calls: Calls = { recordLot: [], reverseLot: [], listLotsWithDraws: [], findLotForAccount: [], lineage: [], invites: [] };
  const lots = options.lots ?? [lotRow()];
  const hold = options.hold ?? 'not_held';

  const lotRepository = {
    async listLotsWithDraws(accountId: string) {
      calls.listLotsWithDraws.push(accountId);
      return options.listError ? { data: null, error: new Error('boom') } : { data: lots, error: null };
    },
    async recordLot(input: Record<string, unknown>) {
      calls.recordLot.push(input);
      const record = options.record ?? { outcome: 'recorded', lotId: NEW_LOT };
      if (record === 'error') return { data: null, error: new Error('write failed') };
      return { data: record.outcome === 'idempotency_key_conflict' ? { outcome: record.outcome } : { outcome: record.outcome, lotId: record.lotId ?? NEW_LOT }, error: null };
    },
    async findLotForAccount(...args: unknown[]) {
      calls.findLotForAccount.push(args);
      const stored = options.storedLot === undefined ? lotRow({ id: NEW_LOT }) : options.storedLot;
      if (stored === 'error') return { data: null, error: new Error('read failed') };
      if (stored === null) return { data: null, error: null };
      const { draws: _draws, ...lot } = stored;
      void _draws;
      return { data: lot, error: null };
    },
    async reverseLot(input: Record<string, unknown>) {
      calls.reverseLot.push(input);
      const reverse = options.reverse ?? { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100, remainingAfter: 60 };
      if (reverse === 'error') return { data: null, error: new Error('write failed') };
      return { data: reverse, error: null };
    },
  } as unknown as CreditLotRepositoryPort;

  const ctx: CreditAdminOpContext = {
    accountId: ACCOUNT,
    adminId: ADMIN,
    now: NOW,
    creditValueVersion: 7,
    lotRepository,
    holdReaders: {
      lineage: {
        async findHoldFactsForAccount(accountId: string) {
          calls.lineage.push(accountId);
          if (hold === 'throws') throw new Error('lineage exploded');
          if (hold === 'lineage_error') return { data: null, error: new Error('lineage read failed') };
          if (hold === 'held') return { data: { source: 'account_invite', first_paid_at: null, invite_id: null }, error: null };
          return { data: null, error: null };
        },
      },
      invites: {
        async findHoldFactsById(id: string) {
          calls.invites.push(id);
          return { data: null, error: null };
        },
      },
    } as unknown as CreditAdminOpContext['holdReaders'],
  };
  return { ctx, calls };
}

const grant = (overrides: Record<string, unknown> = {}) =>
  ({ op: 'grant_credits', amount: 50, expiresAt: '2026-12-31T00:00:00.000Z', requestId: REQUEST, reason: 'goodwill', ...overrides }) as CreditAdminOp;
const reduce = (overrides: Record<string, unknown> = {}) =>
  ({ op: 'reduce_credit_lot', lotId: LOT, amount: 40, requestId: REQUEST, reason: 'mistaken grant', ...overrides }) as CreditAdminOp;

describe('schemas', () => {
  const validGrant = { op: 'grant_credits', amount: 50, expiresAt: '2026-12-31T00:00:00.000Z', requestId: REQUEST, reason: 'goodwill' };
  const validReduce = { op: 'reduce_credit_lot', lotId: LOT, amount: 40, requestId: REQUEST, reason: 'mistaken grant' };

  it('the ceiling is 100,000 whole credits (S11-D-5 B)', () => {
    expect(ADMIN_CREDIT_GRANT_CEILING).toBe(100_000);
    expect(grantCreditsSchema.safeParse({ ...validGrant, amount: 100_000 }).success).toBe(true);
    expect(CREDIT_ADMIN_OP_NAMES).toEqual(['grant_credits', 'reduce_credit_lot']);
  });

  it('grant: a valid body parses', () => {
    expect(grantCreditsSchema.safeParse(validGrant).success).toBe(true);
  });

  it.each([0, -1, 1.5, 100_001, '50'])('grant: amount %p is refused', (amount) => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, amount }).success).toBe(false);
  });

  it('grant: the expiresAt KEY is required; explicit null is "never expires" (S11-D-2 C)', () => {
    const { expiresAt: _omit, ...without } = validGrant;
    void _omit;
    expect(grantCreditsSchema.safeParse(without).success).toBe(false);
    expect(grantCreditsSchema.safeParse({ ...validGrant, expiresAt: null }).success).toBe(true);
  });

  it.each(['2026-12-31', '2026-12-31T00:00:00', 'next tuesday', ''])('grant: expiresAt %p without an offset / not an instant is refused (OP-17)', (expiresAt) => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, expiresAt }).success).toBe(false);
  });

  it('grant: an explicit offset other than Z is accepted', () => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, expiresAt: '2026-12-31T00:00:00+02:00' }).success).toBe(true);
  });

  it('grant: requestId must be a uuid', () => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, requestId: 'req-1' }).success).toBe(false);
  });

  it('grant: reason 3 to 500 characters, trimmed', () => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, reason: 'ab' }).success).toBe(false);
    expect(grantCreditsSchema.safeParse({ ...validGrant, reason: 'x'.repeat(501) }).success).toBe(false);
    expect(grantCreditsSchema.safeParse({ ...validGrant, reason: 'x'.repeat(500) }).success).toBe(true);
    expect(grantCreditsSchema.safeParse({ ...validGrant, reason: '  ab  ' }).success).toBe(false);
    const padded = grantCreditsSchema.safeParse({ ...validGrant, reason: '  goodwill  ' });
    expect(padded.success && padded.data.reason).toBe('goodwill');
  });

  it.each(['accountId', 'userId', 'source', 'creditsBonus'])('grant: an unknown key %s is refused (.strict, account only from the path)', (key) => {
    expect(grantCreditsSchema.safeParse({ ...validGrant, [key]: key === 'creditsBonus' ? 5 : ACCOUNT }).success).toBe(false);
  });

  it('reduce: amount is a whole credit count or "rest", nothing else', () => {
    expect(reduceCreditLotSchema.safeParse(validReduce).success).toBe(true);
    expect(reduceCreditLotSchema.safeParse({ ...validReduce, amount: 'rest' }).success).toBe(true);
    for (const amount of [0, -1, 1.5, 100_001, 'all', 'REST', null]) {
      expect(reduceCreditLotSchema.safeParse({ ...validReduce, amount }).success).toBe(false);
    }
  });

  it('reduce: confirmPaidCredits is literal true only', () => {
    expect(reduceCreditLotSchema.safeParse({ ...validReduce, confirmPaidCredits: true }).success).toBe(true);
    expect(reduceCreditLotSchema.safeParse({ ...validReduce, confirmPaidCredits: false }).success).toBe(false);
  });

  it('reduce: lotId must be a uuid, and is lower-cased (W11b-2)', () => {
    expect(reduceCreditLotSchema.safeParse({ ...validReduce, lotId: 'lot-1' }).success).toBe(false);
    const parsed = reduceCreditLotSchema.safeParse({ ...validReduce, lotId: LOT.toUpperCase() });
    expect(parsed.success && parsed.data.lotId).toBe(LOT);
  });

  it.each(['accountId', 'userId'])('reduce: an injected %s is refused', (key) => {
    expect(reduceCreditLotSchema.safeParse({ ...validReduce, [key]: ACCOUNT }).success).toBe(false);
  });

  it('isCreditAdminOp names exactly the two credit ops', () => {
    expect(isCreditAdminOp({ op: 'grant_credits' })).toBe(true);
    expect(isCreditAdminOp({ op: 'reduce_credit_lot' })).toBe(true);
    expect(isCreditAdminOp({ op: 'set_cohort' })).toBe(false);
  });
});

describe('the platform account (S11-CR-1)', () => {
  const original = process.env.SYSTEM_ADMIN_USER_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
    else process.env.SYSTEM_ADMIN_USER_ID = original;
  });

  it('the system admin id, in any case, is refused with 409 platform_account', () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'eeeeeeee-9999-4999-8999-99999999999e';
    expect(refuseCreditOpForPlatformAccount('eeeeeeee-9999-4999-8999-99999999999e')).toEqual({ ok: false, status: 409, error: 'platform_account' });
    expect(refuseCreditOpForPlatformAccount('EEEEEEEE-9999-4999-8999-99999999999E')).toMatchObject({ error: 'platform_account' });
  });

  it('the all-zero id is refused (and Zod accepts it as a path uuid)', () => {
    expect(refuseCreditOpForPlatformAccount('00000000-0000-0000-0000-000000000000')).toMatchObject({ status: 409, error: 'platform_account' });
  });

  it('an ordinary account passes', () => {
    process.env.SYSTEM_ADMIN_USER_ID = '99999999-9999-4999-8999-999999999999';
    expect(refuseCreditOpForPlatformAccount(ACCOUNT)).toBeNull();
  });
});

describe('grant: pre-checks', () => {
  it('a held account is refused with 409 awaiting_payment, nothing read or written', async () => {
    const { ctx, calls } = context({ hold: 'held' });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 409, error: 'awaiting_payment' });
    expect(calls.listLotsWithDraws).toEqual([]);
    expect(calls.recordLot).toEqual([]);
  });

  it.each<HoldMode>(['lineage_error', 'throws'])('an unreadable hold (%s) fails CLOSED with 500 payment_hold_check_failed (W11b-9)', async (hold) => {
    const { ctx, calls } = context({ hold });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 500, error: 'payment_hold_check_failed' });
    expect(calls.recordLot).toEqual([]);
  });

  it('an expiry exactly at now is refused with 400 expires_at_in_past', async () => {
    const { ctx, calls } = context();
    expect(await executeCreditAdminOp(grant({ expiresAt: NOW.toISOString() }), ctx)).toEqual({ ok: false, status: 400, error: 'expires_at_in_past' });
    expect(calls.recordLot).toEqual([]);
  });

  it('an expiry one millisecond after now proceeds', async () => {
    const { ctx, calls } = context();
    expect(await executeCreditAdminOp(grant({ expiresAt: '2026-10-02T12:00:00.001Z' }), ctx)).toMatchObject({ ok: true });
    expect(calls.recordLot).toHaveLength(1);
  });

  it('an unreadable lot list refuses before writing: 500 credit_lots_unreadable (OP-14)', async () => {
    const { ctx, calls } = context({ listError: true });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 500, error: 'credit_lots_unreadable' });
    expect(calls.recordLot).toEqual([]);
  });

  it('an unreadable figure in the lots (extraCreditsAt null) refuses the same way', async () => {
    const { ctx, calls } = context({ lots: [lotRow({ creditsGranted: Number.NaN })] });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 500, error: 'credit_lots_unreadable' });
    expect(calls.recordLot).toEqual([]);
  });
});

describe('grant: the write', () => {
  it('passes exactly these fields to recordLot, and nothing from the body beyond them', async () => {
    const { ctx, calls } = context();
    const op = { ...grant({ expiresAt: '2026-12-31T02:00:00+02:00' }), accountId: '88888888-8888-4888-8888-888888888888', sneaky: 1 } as unknown as CreditAdminOp;
    await executeCreditAdminOp(op, ctx);

    expect(calls.recordLot).toEqual([
      {
        accountId: ACCOUNT,
        source: 'admin_grant',
        creditsBase: 50,
        creditsBonus: 0,
        creditValueVersion: 7,
        expiresAt: '2026-12-31T00:00:00.000Z',
        idempotencyKey: `admin_grant:${REQUEST.toLowerCase()}`,
        sourceRef: null,
        actorKind: 'admin',
        actorAdminId: ADMIN,
        reason: 'goodwill',
      },
    ]);
  });

  it('the idempotency key is admin_grant: plus the lower-cased request id (W11b-2)', async () => {
    const { ctx, calls } = context();
    await executeCreditAdminOp(grant(), ctx);
    expect(calls.recordLot[0].idempotencyKey).toBe('admin_grant:abcdef12-3456-4789-8abc-def012345678');
  });

  it('a null expiry is recorded as null', async () => {
    const { ctx, calls } = context();
    const result = await executeCreditAdminOp(grant({ expiresAt: null }), ctx);
    expect(calls.recordLot[0].expiresAt).toBeNull();
    expect(result).toMatchObject({ ok: true, data: { expiresAt: null } });
  });

  it('recorded: the audit override carries extraCreditsAt before and before + amount after (expired and fractional lots in the set)', async () => {
    const lots = [
      lotRow({ id: LOT, creditsGranted: 10.5, draws: [{ id: DRAW, lotId: LOT, accountId: ACCOUNT, kind: 'reversal', credits: 0.25, reason: 'x', actorAdminId: ADMIN, idempotencyKey: 'k', createdAt: '2026-09-02T00:00:00.000Z' }] }),
      lotRow({ id: BOOST_LOT, source: 'boost_purchase', creditsGranted: 1000, expiresAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const { ctx } = context({ lots });
    const result = await executeCreditAdminOp(grant(), ctx);

    expect(result).toEqual({
      ok: true,
      action: 'BOS_CREDIT_LOT_GRANTED',
      data: { lotId: NEW_LOT, credits: 50, expiresAt: '2026-12-31T00:00:00.000Z', replayed: false },
      audit: {
        entityType: 'business_os_credit_lot',
        entityId: NEW_LOT,
        // 10.5 − 0.25 = 10.25; the expired 1,000 does not count.
        changes: { extraCreditsBefore: 10.25, extraCreditsAfter: 60.25 },
        details: {
          lotId: NEW_LOT,
          source: 'admin_grant',
          credits: 50,
          expiresAt: '2026-12-31T00:00:00.000Z',
          idempotencyKey: `admin_grant:${REQUEST.toLowerCase()}`,
          extraCreditsBasis: 'read_before_write',
        },
      },
      invalidatesEntitlements: false,
    });
  });

  it('replayed: replayed true, no audit, and the STORED figures even when the request asked otherwise (CR11a-4)', async () => {
    const stored = lotRow({ id: NEW_LOT, creditsGranted: 25, expiresAt: '2027-03-01T00:00:00.000Z' });
    const { ctx, calls } = context({ record: { outcome: 'replayed', lotId: NEW_LOT }, storedLot: stored });
    const result = await executeCreditAdminOp(grant({ amount: 50, expiresAt: '2026-12-31T00:00:00.000Z' }), ctx);

    expect(result).toEqual({
      ok: true,
      action: 'BOS_CREDIT_LOT_GRANTED',
      data: { lotId: NEW_LOT, credits: 25, expiresAt: '2027-03-01T00:00:00.000Z', replayed: true },
      replayed: true,
      invalidatesEntitlements: false,
    });
    expect(result).not.toHaveProperty('audit');
    expect(calls.findLotForAccount).toEqual([[NEW_LOT, ACCOUNT]]);
  });

  it.each<[string, null | 'error']>([
    ['missing', null],
    ['an error', 'error'],
  ])('replayed but the read-back is %s: 500 lot_read_failed', async (_name, storedLot) => {
    const { ctx } = context({ record: { outcome: 'replayed', lotId: NEW_LOT }, storedLot });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 500, error: 'lot_read_failed' });
  });

  it('a key conflict is 409 idempotency_key_conflict', async () => {
    const { ctx } = context({ record: { outcome: 'idempotency_key_conflict' } });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 409, error: 'idempotency_key_conflict' });
  });

  it('a repository error is 500 lot_write_failed, never the database text (M-3)', async () => {
    const { ctx } = context({ record: 'error' });
    expect(await executeCreditAdminOp(grant(), ctx)).toEqual({ ok: false, status: 500, error: 'lot_write_failed' });
  });

  it('a trial or held-free account with a plan row may receive a lot (S11-D-3 A): no plan input is consulted here', async () => {
    const { ctx } = context();
    expect(await executeCreditAdminOp(grant(), ctx)).toMatchObject({ ok: true });
  });
});

describe('reduce', () => {
  const lots = () => [
    lotRow({ id: LOT, creditsGranted: 100 }),
    lotRow({ id: BOOST_LOT, source: 'boost_purchase', actorKind: 'stripe_webhook', actorAdminId: null, creditsGranted: 13.75 }),
  ];

  it('a lot of another account (absent from the list) is 404, and reverseLot is never called (tenant-isolation-guard Step 7)', async () => {
    const { ctx, calls } = context({ lots: lots() });
    expect(await executeCreditAdminOp(reduce({ lotId: FOREIGN_LOT }), ctx)).toEqual({ ok: false, status: 404, error: 'lot_not_found' });
    expect(calls.reverseLot).toEqual([]);
  });

  it('a real lot sent upper-cased proceeds; a foreign one upper-cased is still 404 (W11b-2)', async () => {
    expect(LOT.toUpperCase()).not.toBe(LOT);
    const parsedOwn = reduceCreditLotSchema.parse({ op: 'reduce_credit_lot', lotId: LOT.toUpperCase(), amount: 40, requestId: REQUEST, reason: 'mistaken grant' });
    const own = context({ lots: lots() });
    expect(await executeCreditAdminOp(parsedOwn, own.ctx)).toMatchObject({ ok: true });
    expect(own.calls.reverseLot[0].lotId).toBe(LOT);

    const parsedForeign = reduceCreditLotSchema.parse({ op: 'reduce_credit_lot', lotId: FOREIGN_LOT.toUpperCase(), amount: 40, requestId: REQUEST, reason: 'mistaken grant' });
    const foreign = context({ lots: lots() });
    expect(await executeCreditAdminOp(parsedForeign, foreign.ctx)).toMatchObject({ status: 404, error: 'lot_not_found' });
    expect(foreign.calls.reverseLot).toEqual([]);
  });

  it('a boost lot without the flag is 409 paid_credits_locked; with it, it proceeds (S11-D-7 A)', async () => {
    const refused = context({ lots: lots() });
    expect(await executeCreditAdminOp(reduce({ lotId: BOOST_LOT }), refused.ctx)).toEqual({ ok: false, status: 409, error: 'paid_credits_locked' });
    expect(refused.calls.reverseLot).toEqual([]);

    const confirmed = context({ lots: lots() });
    expect(await executeCreditAdminOp(reduce({ lotId: BOOST_LOT, confirmPaidCredits: true }), confirmed.ctx)).toMatchObject({ ok: true });
    expect(confirmed.calls.reverseLot).toHaveLength(1);
  });

  it('passes exactly these fields to reverseLot; "rest" passes through', async () => {
    const { ctx, calls } = context({ lots: lots() });
    await executeCreditAdminOp(reduce({ amount: 'rest' }), ctx);
    expect(calls.reverseLot).toEqual([
      {
        accountId: ACCOUNT,
        lotId: LOT,
        credits: 'rest',
        idempotencyKey: `admin_reversal:${REQUEST.toLowerCase()}`,
        actorAdminId: ADMIN,
        reason: 'mistaken grant',
      },
    ]);
  });

  it('the payment hold is NOT read for a reduction (OP-12)', async () => {
    const { ctx, calls } = context({ lots: lots(), hold: 'held' });
    expect(await executeCreditAdminOp(reduce(), ctx)).toMatchObject({ ok: true });
    expect(calls.lineage).toEqual([]);
  });

  it('an unreadable lot list is 500 credit_lots_unreadable, reverseLot not called', async () => {
    const { ctx, calls } = context({ listError: true });
    expect(await executeCreditAdminOp(reduce(), ctx)).toEqual({ ok: false, status: 500, error: 'credit_lots_unreadable' });
    expect(calls.reverseLot).toEqual([]);
  });

  it('recorded: the audit uses the function\'s lot figures and before − credits for the account', async () => {
    const { ctx } = context({
      lots: lots(),
      reverse: { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100, remainingAfter: 60 },
    });
    expect(await executeCreditAdminOp(reduce(), ctx)).toEqual({
      ok: true,
      action: 'BOS_CREDIT_LOT_REDUCED',
      data: { lotId: LOT, drawId: DRAW, credits: 40, lotRemainingAfter: 60, replayed: false },
      audit: {
        entityType: 'business_os_credit_lot',
        entityId: LOT,
        changes: { extraCreditsBefore: 113.75, extraCreditsAfter: 73.75, lotRemainingBefore: 100, lotRemainingAfter: 60 },
        details: {
          lotId: LOT,
          source: 'admin_grant',
          credits: 40,
          drawId: DRAW,
          idempotencyKey: `admin_reversal:${REQUEST.toLowerCase()}`,
          extraCreditsBasis: 'read_before_write',
        },
      },
      invalidatesEntitlements: false,
    });
  });

  it('already_recorded: replayed, the RETURNED credits (not the requested amount), no audit (QA11a-2)', async () => {
    const { ctx } = context({
      lots: lots(),
      reverse: { status: 'already_recorded', drawId: DRAW, credits: 30, remainingBefore: 70, remainingAfter: 70 },
    });
    const result = await executeCreditAdminOp(reduce({ amount: 40 }), ctx);
    expect(result).toEqual({
      ok: true,
      action: 'BOS_CREDIT_LOT_REDUCED',
      data: { lotId: LOT, drawId: DRAW, credits: 30, lotRemainingAfter: 70, replayed: true },
      replayed: true,
      invalidatesEntitlements: false,
    });
    expect(result).not.toHaveProperty('audit');
  });

  const noFigures = { drawId: null, credits: null, remainingBefore: null, remainingAfter: null };
  it.each<[BusinessOsCreditLotReverseResult['status'], number, string]>([
    ['lot_not_found', 404, 'lot_not_found'],
    ['lot_expired', 409, 'lot_expired'],
    ['nothing_left', 409, 'nothing_left'],
    ['idempotency_key_conflict', 409, 'idempotency_key_conflict'],
  ])('function status %s maps to %d %s', async (status, httpStatus, error) => {
    const { ctx } = context({ lots: lots(), reverse: { status, ...noFigures } });
    expect(await executeCreditAdminOp(reduce(), ctx)).toEqual({ ok: false, status: httpStatus, error });
  });

  it('exceeds_remaining carries the remaining read before the attempt, exact to 6 dp, and its basis (W11b-10)', async () => {
    const fractional = [
      lotRow({ id: LOT, creditsGranted: 50.5, draws: [{ id: DRAW, lotId: LOT, accountId: ACCOUNT, kind: 'reversal', credits: 0.000001, reason: 'x', actorAdminId: ADMIN, idempotencyKey: 'k', createdAt: '2026-09-02T00:00:00.000Z' }] }),
    ];
    const { ctx } = context({ lots: fractional, reverse: { status: 'exceeds_remaining', ...noFigures } });
    expect(await executeCreditAdminOp(reduce({ amount: 60 }), ctx)).toEqual({
      ok: false,
      status: 409,
      error: 'exceeds_remaining',
      details: { remaining: 50.499999, remainingBasis: 'read_before_write' },
    });
  });

  it('a repository error is 500 lot_write_failed', async () => {
    const { ctx } = context({ lots: lots(), reverse: 'error' });
    expect(await executeCreditAdminOp(reduce(), ctx)).toEqual({ ok: false, status: 500, error: 'lot_write_failed' });
  });

  // ── CR11b-2 (slice 11c, SA OP-35, W11c-9) ─────────────────────────────────
  it('CR11b-2: a healthy partial reduction keeps the pre-11c figure (the draw stamped at now is counted at now)', async () => {
    const { ctx } = context({
      lots: lots(),
      reverse: { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100, remainingAfter: 60 },
    });
    const result = await executeCreditAdminOp(reduce(), ctx);
    // 113.75 − 40: had the synthetic draw been dropped as "after now", this would read 113.75.
    expect(result).toMatchObject({ audit: { changes: { extraCreditsBefore: 113.75, extraCreditsAfter: 73.75 } } });
  });

  it('CR11b-2: an inconsistent (clamped) lot gives the exact figure, not before − credits', async () => {
    // LOT has drawn 120 of 100: clamped to 0 by extraCreditsAt. Only the boost lot counts.
    const inconsistent = [
      lotRow({
        id: LOT,
        creditsGranted: 100,
        draws: [{ id: DRAW, lotId: LOT, accountId: ACCOUNT, kind: 'reversal', credits: 120, reason: 'x', actorAdminId: ADMIN, idempotencyKey: 'k', createdAt: '2026-09-02T00:00:00.000Z' }],
      }),
      lotRow({ id: BOOST_LOT, source: 'boost_purchase', actorKind: 'stripe_webhook', actorAdminId: null, creditsGranted: 13.75 }),
    ];
    const { ctx } = context({
      lots: inconsistent,
      reverse: { status: 'recorded', drawId: DRAW, credits: 10, remainingBefore: 0, remainingAfter: 0 },
    });
    const result = await executeCreditAdminOp(reduce({ amount: 10 }), ctx);
    // The old arithmetic would say 13.75 − 10 = 3.75; the lot stays clamped at 0, so 13.75.
    expect(result).toMatchObject({ audit: { changes: { extraCreditsBefore: 13.75, extraCreditsAfter: 13.75 } } });
  });

  it('CR11b-2: a reduction of the other lot of an inconsistent account still subtracts exactly', async () => {
    const inconsistent = [
      lotRow({
        id: LOT,
        creditsGranted: 100,
        draws: [{ id: DRAW, lotId: LOT, accountId: ACCOUNT, kind: 'reversal', credits: 120, reason: 'x', actorAdminId: ADMIN, idempotencyKey: 'k', createdAt: '2026-09-02T00:00:00.000Z' }],
      }),
      lotRow({ id: BOOST_LOT, source: 'boost_purchase', actorKind: 'stripe_webhook', actorAdminId: null, creditsGranted: 13.75 }),
    ];
    const { ctx } = context({
      lots: inconsistent,
      reverse: { status: 'recorded', drawId: DRAW, credits: 3.5, remainingBefore: 13.75, remainingAfter: 10.25 },
    });
    const result = await executeCreditAdminOp(reduce({ lotId: BOOST_LOT, amount: 3.5, confirmPaidCredits: true }), ctx);
    expect(result).toMatchObject({ audit: { changes: { extraCreditsBefore: 13.75, extraCreditsAfter: 10.25 } } });
  });
});

describe('reason bounds (slice 11c, SA W11c-6)', () => {
  it('are exported as 3 and 500, matching the table CHECKs', () => {
    expect(CREDIT_REASON_MIN).toBe(3);
    expect(CREDIT_REASON_MAX).toBe(500);
  });

  it('are the bounds the schema itself enforces', () => {
    const base = { op: 'grant_credits', amount: 1, expiresAt: null, requestId: REQUEST.toLowerCase() };
    expect(grantCreditsSchema.safeParse({ ...base, reason: 'x'.repeat(CREDIT_REASON_MIN) }).success).toBe(true);
    expect(grantCreditsSchema.safeParse({ ...base, reason: 'x'.repeat(CREDIT_REASON_MIN - 1) }).success).toBe(false);
    expect(grantCreditsSchema.safeParse({ ...base, reason: 'x'.repeat(CREDIT_REASON_MAX) }).success).toBe(true);
    expect(grantCreditsSchema.safeParse({ ...base, reason: 'x'.repeat(CREDIT_REASON_MAX + 1) }).success).toBe(false);
  });
});

describe('source guards (G11b-2, G11b-3, SA W11b-4)', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'credits', 'creditAdminOps.ts'), 'utf8');
  const imports = [...source.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"];?$/gm)].map((match) => match[1]);

  it('imports nothing from the entitlements module, type-only included', () => {
    expect(source).not.toMatch(/business-os\/entitlements/);
    expect(source).not.toMatch(/from ['"]\.\.?\/.*entitlements/);
    expect(source).not.toMatch(/import\s+type[^;]*entitlements/);
  });

  it('imports only the allowed modules', () => {
    expect(imports.sort()).toEqual(
      [
        '@/lib/business-os/credits/creditLots',
        '@/lib/business-os/invites/paymentHold',
        '@/lib/business-os/llm/callCatalog',
        '@/lib/repositories/BusinessOsCreditLotRepository',
        'zod',
      ].sort()
    );
    // The repository is a TYPE import only: the executor never holds the singleton.
    expect(source).toMatch(/import type \{[^}]*\} from '@\/lib\/repositories\/BusinessOsCreditLotRepository';/);
  });

  it('holds no database client and writes nothing directly', () => {
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('every audit action literal is a registered AUDIT_EVENTS key', () => {
    const actions = [...source.matchAll(/'(BOS_CREDIT_LOT_[A-Z0-9_]+)'/g)].map((match) => match[1]);
    expect(new Set(actions)).toEqual(new Set(['BOS_CREDIT_LOT_GRANTED', 'BOS_CREDIT_LOT_REDUCED']));
    expect(actions.filter((action) => !(action in AUDIT_EVENTS))).toEqual([]);
  });
});
