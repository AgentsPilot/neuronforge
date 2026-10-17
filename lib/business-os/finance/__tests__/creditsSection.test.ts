/**
 * Section 4, credits (finance & business health slice 1b): the pure figures.
 * AC-8 (no lots → 0), AC-11 (the method of SQL check 5, after the SA-W9 edit),
 * AC-17 (one unknown account), AC-19 (150% far over, 149.9% not), SA-W9 /
 * SA-WR-9 (a deleted account's lot stays out of K-4), SA-W10 (the line is
 * data), SA-W15 (the display cap), SA-W17 (tenths, rounded down) and the
 * failure split (SA-W12).
 *
 * Fixtures name no tier literal: the one tier comes from `config.tierOrder`.
 */

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { AdminCreditPosition } from '@/lib/business-os/credits/adminCreditPercent';
import { buildCreditsSection, type CreditsSectionInput, type FinanceLot } from '../creditsSection';
import type { FinanceGroupKey } from '../financeTypes';

const TIER = getEntitlementConfig().tierOrder[0];
const TIER_KEY: FinanceGroupKey = `tier:${TIER}`;

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uid(1);
const B = uid(2);
const C = uid(3);
const D = uid(4);
const Z = uid(99);
const ADMIN_X = uid(501);
const ADMIN_Y = uid(502);

const NOW = new Date('2026-11-09T12:00:00.000Z');
const WINDOW = { start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-11-10T00:00:00.000Z') };

const position = (allowance: number, used: number, trial = false): AdminCreditPosition => ({ kind: 'position', allowance, used, trial });

let lotSeq = 0;
function lot(accountId: string | null, creditsGranted: number, extra: Partial<FinanceLot> = {}): FinanceLot {
  lotSeq += 1;
  return {
    id: uid(1000 + lotSeq),
    accountId,
    source: 'admin_grant',
    creditsGranted,
    expiresAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    actorAdminId: ADMIN_X,
    draws: [],
    ...extra,
  };
}
const reversal = (credits: number, createdAt = '2026-11-03T10:00:00.000Z') => ({ kind: 'reversal' as const, credits, createdAt });

function input(over: Partial<CreditsSectionInput> = {}): CreditsSectionInput {
  return {
    accountIds: [A, B],
    groupOf: (id) => (id === A ? 'founding_partner' : TIER_KEY),
    tierLabelOf: (key) => (key === TIER_KEY ? 'Tier label from config' : null),
    positions: new Map([
      [A, position(100, 40)],
      [B, position(100, 160)],
    ]),
    lots: [],
    window: WINDOW,
    now: NOW,
    farOverAllowancePercent: 150,
    displayCap: 200,
    ...over,
  };
}

/**
 * SQL check 5's arithmetic, after the SA-W9 edit, typed out independently:
 * admin-grant lots of EXISTING accounts (`user_id is not null`), not expired
 * (`expires_at is null or expires_at > now()`), each contributing
 * `greatest(0, credits_granted - sum(draws))`.
 */
function checkFive(lots: readonly FinanceLot[], now: Date): number {
  let micro = 0;
  for (const l of lots) {
    if (l.source !== 'admin_grant' || l.accountId === null) continue;
    if (l.expiresAt !== null && Date.parse(l.expiresAt) <= now.getTime()) continue;
    const drawn = l.draws.reduce((sum, d) => sum + Math.round(d.credits * 1e6), 0);
    micro += Math.max(0, Math.round(l.creditsGranted * 1e6) - drawn);
  }
  return micro / 1e6;
}

describe('the over-allowance figures (S1-FR-21, S1-FR-22)', () => {
  it('rows carry allowance, used, % used in tenths, over and far over; groups and tier labels from the classification', () => {
    const result = buildCreditsSection(input());
    expect(result.figures).toMatchObject({ accounts: 2, overAllowance: 1, farOverAllowance: 1, unknownAccounts: 0, noAllowanceAccounts: 0 });
    expect(result.figures?.rows).toEqual([
      {
        accountId: B, group: TIER_KEY, tierLabel: 'Tier label from config', kind: 'position', allowance: 100, used: 160,
        usedTenths: 1600, trial: false, overAllowance: true, farOverAllowance: true, giftedOutstanding: 0, boughtOutstanding: 0,
      },
      {
        accountId: A, group: 'founding_partner', tierLabel: null, kind: 'position', allowance: 100, used: 40,
        usedTenths: 400, trial: false, overAllowance: false, farOverAllowance: false, giftedOutstanding: 0, boughtOutstanding: 0,
      },
    ]);
  });

  it('AC-19: 150% is far over; 149.9% is not; exactly 100% is not over and shows 100.0%', () => {
    const result = buildCreditsSection(
      input({
        accountIds: [A, B, C, D],
        positions: new Map([
          [A, position(100, 150)],
          [B, position(100, 149.9)],
          [C, position(100, 100)],
          [D, position(100, 100.000001)],
        ]),
      })
    );
    const row = (id: string) => result.figures?.rows.find((r) => r.accountId === id);
    expect(row(A)).toMatchObject({ farOverAllowance: true, overAllowance: true, usedTenths: 1500 });
    expect(row(B)).toMatchObject({ farOverAllowance: false, overAllowance: true, usedTenths: 1499 });
    expect(row(C)).toMatchObject({ farOverAllowance: false, overAllowance: false, usedTenths: 1000 });
    expect(row(D)).toMatchObject({ farOverAllowance: false, overAllowance: true, usedTenths: 1000 });
    expect(result.figures).toMatchObject({ overAllowance: 3, farOverAllowance: 1 });
  });

  it('SA-W17: % used is floored in tenths, never rounded up into the K-2 band; a tiny figure floors to 0', () => {
    const result = buildCreditsSection(
      input({ positions: new Map([[A, position(100, 149.95)], [B, position(100, 0.00001)]]) })
    );
    const row = (id: string) => result.figures?.rows.find((r) => r.accountId === id);
    expect(row(A)).toMatchObject({ usedTenths: 1499, farOverAllowance: false });
    expect(row(B)).toMatchObject({ usedTenths: 0, used: 0.00001 });
  });

  it('AC-17: one unknown account → only that row unknown; the counts exclude it and say how many', () => {
    const result = buildCreditsSection(
      input({ accountIds: [A, B, C], positions: new Map([[A, position(100, 200)], [B, { kind: 'unknown' }], [C, { kind: 'no_allowance' }]]) })
    );
    expect(result.figures).toMatchObject({ accounts: 3, overAllowance: 1, farOverAllowance: 1, unknownAccounts: 1, noAllowanceAccounts: 1 });
    expect(result.figures?.rows.map((r) => [r.accountId, r.kind])).toEqual([
      [A, 'position'],
      [C, 'no_allowance'],
      [B, 'unknown'],
    ]);
    expect(result.figures?.rows[2]).toMatchObject({ allowance: null, used: null, usedTenths: null, overAllowance: null, farOverAllowance: null });
  });

  it('an account missing from the pass, or a figure that cannot be compared exactly, is unknown (never a guess)', () => {
    const result = buildCreditsSection(
      input({ accountIds: [A, B, C], positions: new Map([[A, position(0, 5)], [B, position(Number.NaN, 1)]]) })
    );
    expect(result.figures?.unknownAccounts).toBe(3);
    expect(result.figures?.rows.every((r) => r.kind === 'unknown')).toBe(true);
  });

  it('a trial position is marked trial', () => {
    const result = buildCreditsSection(input({ accountIds: [A], positions: new Map([[A, position(50, 10, true)]]) }));
    expect(result.figures?.rows[0]).toMatchObject({ trial: true, usedTenths: 200 });
  });

  it('SA-W10: the line is data — at 120 the same figures count one more account', () => {
    const positions = new Map([
      [A, position(100, 130)],
      [B, position(100, 160)],
    ]);
    expect(buildCreditsSection(input({ positions })).figures?.farOverAllowance).toBe(1);
    expect(buildCreditsSection(input({ positions, farOverAllowancePercent: 120 })).figures?.farOverAllowance).toBe(2);
  });

  it('an invalid line (null) → far over unknown on every row and in the count; the rest stays', () => {
    const result = buildCreditsSection(input({ farOverAllowancePercent: null }));
    expect(result.figures?.farOverAllowance).toBeNull();
    expect(result.figures?.overAllowance).toBe(1);
    expect(result.figures?.rows.map((r) => r.farOverAllowance)).toEqual([null, null]);
  });
});

describe('sorting and the display cap (SA-W15)', () => {
  it('highest % used first, then no allowance, then unknown; ties by account id', () => {
    const result = buildCreditsSection(
      input({
        accountIds: [D, C, B, A],
        positions: new Map<string, AdminCreditPosition>([
          [A, position(100, 50)],
          [B, position(100, 50)],
          [C, { kind: 'unknown' }],
          [D, { kind: 'no_allowance' }],
        ]),
      })
    );
    expect(result.figures?.rows.map((r) => r.accountId)).toEqual([A, B, D, C]);
  });

  it('201 accounts → 200 rows shown; every count covers all 201', () => {
    const ids = Array.from({ length: 201 }, (_v, i) => uid(2000 + i));
    // Account i used i credits of 100: the lowest one drops off the table.
    const positions = new Map(ids.map((id, i) => [id, position(100, i)]));
    const result = buildCreditsSection(input({ accountIds: ids, positions }));
    expect(result.figures?.accounts).toBe(201);
    expect(result.figures?.rows).toHaveLength(200);
    expect(result.figures?.rows[0].accountId).toBe(ids[200]);
    expect(result.figures?.rows.some((r) => r.accountId === ids[0])).toBe(false);
    expect(result.figures?.overAllowance).toBe(100);
    expect(result.figures?.farOverAllowance).toBe(51);
  });

  it('a row past the cap still counts', () => {
    const result = buildCreditsSection(
      input({ accountIds: [A, B, C], positions: new Map([[A, position(10, 30)], [B, position(10, 20)], [C, position(10, 15)]]), displayCap: 2 })
    );
    expect(result.figures?.rows.map((r) => r.accountId)).toEqual([A, B]);
    expect(result.figures?.farOverAllowance).toBe(3);
  });
});

describe('gifted credits, K-4 and the window (AC-8, AC-11, SA-W9)', () => {
  it('AC-8: no lots → every row 0, K-4 exactly 0, nothing on deleted accounts, an empty window', () => {
    const result = buildCreditsSection(input({ lots: [] }));
    expect(result.figures?.rows.map((r) => r.giftedOutstanding)).toEqual([0, 0]);
    expect(result.gifted).toEqual({
      outstanding: 0,
      accountsNotListed: 0,
      deletedAccountsOutstanding: 0,
      inconsistentAccounts: 0,
      window: { granted: 0, takenBack: 0, grants: 0, grantingAdmins: 0 },
    });
  });

  it('AC-11 + SA-WR-9: K-4 equals check 5 (granted 100.5, reversal 40, an expired lot, a lot expiring exactly now); a deleted account’s lot stays OUT of K-4', () => {
    const lots: FinanceLot[] = [
      lot(A, 100.5, { draws: [reversal(40)] }),
      lot(A, 50, { expiresAt: '2026-11-01T00:00:00.000Z' }),
      // Expires exactly now: expired (the `<=` rule).
      lot(B, 20, { expiresAt: NOW.toISOString(), createdAt: '2026-11-05T10:00:00.000Z', actorAdminId: ADMIN_X }),
      // A deleted account's grant (user_id NULL): never in K-4.
      lot(null, 30, { createdAt: '2026-11-02T10:00:00.000Z', actorAdminId: ADMIN_Y }),
    ];
    const result = buildCreditsSection(input({ lots }));

    expect(checkFive(lots, NOW)).toBe(60.5);
    expect(result.gifted?.outstanding).toBe(checkFive(lots, NOW));
    // Without the SA-W9 edit, check 5 would have counted the deleted lot too.
    expect(result.gifted?.outstanding).not.toBe(60.5 + 30);
    expect(result.gifted?.deletedAccountsOutstanding).toBe(30);
    expect(result.figures?.rows.find((r) => r.accountId === A)?.giftedOutstanding).toBe(60.5);
    expect(result.figures?.rows.find((r) => r.accountId === B)?.giftedOutstanding).toBe(0);
    // The window counts the deleted account's grant (it happened), and the reversal in the window.
    expect(result.gifted?.window).toEqual({ granted: 50, takenBack: 40, grants: 2, grantingAdmins: 2 });
  });

  it('the window leaves out a grant and a reversal outside it', () => {
    const lots = [lot(A, 10, { createdAt: '2026-10-20T00:00:00.000Z', draws: [reversal(4, '2026-10-25T00:00:00.000Z')] })];
    expect(buildCreditsSection(input({ lots })).gifted?.window).toEqual({ granted: 0, takenBack: 0, grants: 0, grantingAdmins: 0 });
  });

  it('a lot created after now does not count yet', () => {
    const lots = [lot(A, 10, { createdAt: '2026-11-09T12:00:01.000Z' })];
    expect(buildCreditsSection(input({ lots })).gifted?.outstanding).toBe(0);
  });

  it('an inconsistent lot is clamped to 0 and counted, never hidden', () => {
    const lots = [lot(A, 10, { draws: [reversal(15)] }), lot(B, 5)];
    const result = buildCreditsSection(input({ lots }));
    expect(result.gifted).toMatchObject({ outstanding: 5, inconsistentAccounts: 1 });
  });

  it('boost lots are left out (slice 4)', () => {
    const lots = [lot(A, 10, { source: 'boost_purchase', actorAdminId: null })];
    const result = buildCreditsSection(input({ lots }));
    expect(result.gifted).toMatchObject({ outstanding: 0, window: { granted: 0, grants: 0 } });
  });

  it('gifted credits of an account with no row in the table count in K-4 and are reported', () => {
    const lots = [lot(Z, 7), lot(A, 3)];
    const result = buildCreditsSection(input({ lots }));
    expect(result.gifted).toMatchObject({ outstanding: 10, accountsNotListed: 1 });
  });

  it('one account’s unreadable lot → that row unknown and K-4 unknown (never a partial sum); the others still show', () => {
    const lots = [lot(A, 10, { createdAt: 'not-a-date' }), lot(B, 5)];
    const result = buildCreditsSection(input({ lots }));
    expect(result.gifted?.outstanding).toBeNull();
    expect(result.figures?.rows.find((r) => r.accountId === A)?.giftedOutstanding).toBeNull();
    expect(result.figures?.rows.find((r) => r.accountId === B)?.giftedOutstanding).toBe(5);
  });
});

describe('the failure split (SA-W12, AC-16, AC-38)', () => {
  it('lots null (read failed) → gifted column, K-4 and the window unknown; the table and counts still render', () => {
    const result = buildCreditsSection(input({ lots: null }));
    expect(result.gifted).toBeNull();
    expect(result.figures).toMatchObject({ accounts: 2, farOverAllowance: 1 });
    expect(result.figures?.rows.map((r) => r.giftedOutstanding)).toEqual([null, null]);
  });

  it('positions null (pass failed) → no figures; gifted credits still computed (K-4 does not need the pass)', () => {
    const result = buildCreditsSection(input({ positions: null, lots: [lot(A, 12)] }));
    expect(result.figures).toBeNull();
    expect(result.gifted?.outstanding).toBe(12);
  });

  it('no account list (walk failed or capped) → no figures; accounts-not-listed unknown', () => {
    const result = buildCreditsSection(input({ accountIds: null, positions: null, lots: [lot(A, 12)] }));
    expect(result.figures).toBeNull();
    expect(result.gifted).toMatchObject({ outstanding: 12, accountsNotListed: null });
  });
});

describe('slice 6a: the non-wire rowByAccount (SA-W78)', () => {
  it('holds EVERY account’s row before the display cap, the same objects the shown rows come from', () => {
    const ids = [A, B, C, D];
    const result = buildCreditsSection(
      input({
        accountIds: ids,
        positions: new Map([
          [A, position(100, 40)],
          [B, position(100, 160)],
          [C, position(100, 90)],
          [D, { kind: 'no_allowance' }],
        ]),
        displayCap: 2,
      })
    );
    expect(result.figures?.rows).toHaveLength(2);
    expect(result.rowByAccount?.size).toBe(4);
    for (const row of result.figures?.rows ?? []) expect(result.rowByAccount?.get(row.accountId)).toEqual(row);
    expect(result.rowByAccount?.get(D)?.kind).toBe('no_allowance');
    expect(result.rowByAccount?.get(A)?.usedTenths).toBe(400);
  });

  it('is null exactly when figures is null (no pass, or the walk failed)', () => {
    expect(buildCreditsSection(input({ positions: null })).rowByAccount).toBeNull();
    expect(buildCreditsSection(input({ accountIds: null })).rowByAccount).toBeNull();
  });
});

// ── Slice 4b.2: bought credits beside gifted, never combined (S4-FR-18 to S4-FR-20, AC-104, AC-105, AC-228) ──
describe('slice 4b.2: bought credits', () => {
  const boostLot = (accountId: string | null, credits: number, extra: Partial<FinanceLot> = {}) =>
    lot(accountId, credits, { source: 'boost_purchase', actorAdminId: null, ...extra });

  it('AC-104: bought outstanding and bought in the window over boost lots only; K-4 and gifted unchanged', () => {
    const lots = [lot(A, 10), boostLot(A, 5000, { createdAt: '2026-11-02T00:00:00.000Z' }), boostLot(B, 1000)];
    const result = buildCreditsSection(input({ lots }));
    expect(result.gifted).toMatchObject({ outstanding: 10, window: { granted: 0, grants: 0 } });
    expect(result.bought).toEqual({ outstanding: 6000, deletedAccountsOutstanding: 0, window: { credits: 5000, lots: 1 }, refundNotTakenBack: false });
    const rows = new Map(result.figures!.rows.map((r) => [r.accountId, r]));
    expect(rows.get(A)).toMatchObject({ giftedOutstanding: 10, boughtOutstanding: 5000 });
    expect(rows.get(B)).toMatchObject({ giftedOutstanding: 0, boughtOutstanding: 1000 });
  });

  it('AC-105: deleted accounts’ bought lots are their own figure; 0 for an account with no boost lot; null when the lots failed', () => {
    const result = buildCreditsSection(input({ lots: [boostLot(null, 300)] }));
    expect(result.bought).toMatchObject({ outstanding: 0, deletedAccountsOutstanding: 300 });
    expect(result.figures!.rows.every((r) => r.boughtOutstanding === 0)).toBe(true);
    const failed = buildCreditsSection(input({ lots: null }));
    expect(failed.bought).toBeNull();
    expect(failed.figures!.rows.map((r) => r.boughtOutstanding)).toEqual([null, null]);
  });

  it('AC-228: the "not taken back" flag follows the input only; nothing here reads an event', () => {
    expect(buildCreditsSection(input({ refundNotTakenBack: true })).bought?.refundNotTakenBack).toBe(true);
    expect(buildCreditsSection(input()).bought?.refundNotTakenBack).toBe(false);
  });

  it('E-103: bought is always set (null or figures), and every row carries boughtOutstanding', () => {
    for (const result of [buildCreditsSection(input()), buildCreditsSection(input({ positions: null }))]) {
      expect(result).toHaveProperty('bought');
      for (const row of result.figures?.rows ?? []) expect(row).toHaveProperty('boughtOutstanding');
    }
  });
});
