/**
 * The payment hold in batch (plan payments P-5b.2; SA-P18, T-9, P5-C10, C-8).
 *
 * Pinned here: the same answer as `readPaymentHold`, account by account, over
 * every lineage case; batches of 200 for both reads; the invite read only for
 * unpaid `admin_invite` rows; any failed batch (or a thrown reader) is
 * `{ ok: false }`, never "nobody is held"; and the module imports nothing from
 * the entitlements module (no cycle with `report.ts`).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { BusinessOsAccountHoldFactsRow, BusinessOsInviteGrantKind } from '@/lib/repositories/types';

import { readPaymentHold } from '../paymentHold';
import { HOLD_BATCH_SIZE, readAwaitingPaymentAccounts, type AwaitingPaymentReaders } from '../paymentHoldBatch';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const inviteOf = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

/** One fixture world: lineage rows by account, grant kinds by invite. */
function world(lineage: BusinessOsAccountHoldFactsRow[], grants: Record<string, BusinessOsInviteGrantKind>) {
  const lineageBatches: string[][] = [];
  const inviteBatches: string[][] = [];
  const readers: AwaitingPaymentReaders = {
    lineage: {
      findHoldFactsForAccountsForAdmin: jest.fn(async (ids: string[]) => {
        lineageBatches.push(ids);
        if (ids.length > 200) return { data: null, error: new Error('too many ids') };
        return { data: lineage.filter((row) => ids.includes(row.account_id)), error: null };
      }),
    },
    invites: {
      findGrantKindsByIdsForAdmin: jest.fn(async (ids: string[]) => {
        inviteBatches.push(ids);
        if (ids.length > 200) return { data: null, error: new Error('too many ids') };
        return { data: ids.filter((id) => id in grants).map((id) => ({ id, grant_kind: grants[id] })), error: null };
      }),
    },
  };
  return { readers, lineageBatches, inviteBatches };
}

describe('parity with readPaymentHold (P5-C10: the gate and the views can never disagree)', () => {
  const cases: Array<[string, Omit<BusinessOsAccountHoldFactsRow, 'account_id'> | null, BusinessOsInviteGrantKind | null]> = [
    ['an unpaid friend', { invite_id: inviteOf(1), source: 'account_invite', first_paid_at: null }, null],
    ['an unpaid friend with no invite id', { invite_id: null, source: 'account_invite', first_paid_at: null }, null],
    ['a paid friend', { invite_id: inviteOf(2), source: 'account_invite', first_paid_at: '2026-10-12T00:00:00Z' }, null],
    ['an unpaid admin Paid (tier) invitee', { invite_id: inviteOf(3), source: 'admin_invite', first_paid_at: null }, 'tier'],
    ['a paid admin Paid (tier) invitee', { invite_id: inviteOf(4), source: 'admin_invite', first_paid_at: '2026-10-12T00:00:00Z' }, 'tier'],
    ['an admin champion (cohort) invitee', { invite_id: inviteOf(5), source: 'admin_invite', first_paid_at: null }, 'cohort'],
    ['an admin invitee whose invite row is gone', { invite_id: inviteOf(6), source: 'admin_invite', first_paid_at: null }, null],
    ['an organic account', { invite_id: null, source: 'organic', first_paid_at: null }, null],
    ['an account with no lineage row', null, null],
  ];

  it.each(cases)('%s: the same answer one by one and in batch', async (_label, facts, grantKind) => {
    const accountId = uuid(1);
    const lineage = facts ? [{ account_id: accountId, ...facts }] : [];
    const grants: Record<string, BusinessOsInviteGrantKind> = facts?.invite_id && grantKind ? { [facts.invite_id]: grantKind } : {};
    const { readers } = world(lineage, grants);

    const single = await readPaymentHold(accountId, {
      lineage: { findHoldFactsForAccount: async () => ({ data: facts, error: null }) },
      invites: {
        findHoldFactsById: async (id: string) => ({ data: grants[id] ? { grant_kind: grants[id], language: 'en' } : null, error: null }),
      },
    });
    const batch = await readAwaitingPaymentAccounts([accountId], readers);

    expect(single.ok).toBe(true);
    expect(batch.ok).toBe(true);
    if (single.ok && batch.ok) expect(batch.held.has(accountId)).toBe(single.held);
  });

  it('all cases at once give each account its own answer', async () => {
    const lineage: BusinessOsAccountHoldFactsRow[] = [];
    const grants: Record<string, BusinessOsInviteGrantKind> = {};
    cases.forEach(([, facts, grantKind], index) => {
      if (facts) lineage.push({ account_id: uuid(index), ...facts });
      if (facts?.invite_id && grantKind) grants[facts.invite_id] = grantKind;
    });
    const { readers } = world(lineage, grants);
    const batch = await readAwaitingPaymentAccounts(cases.map((_c, index) => uuid(index)), readers);
    expect(batch.ok).toBe(true);
    if (batch.ok) expect([...batch.held].sort()).toEqual([uuid(0), uuid(1), uuid(3)]);
  });
});

describe('batched reads (P5-C10)', () => {
  it(`reads lineage in batches of ${HOLD_BATCH_SIZE}, and invites only for unpaid admin-invite rows, in batches too`, async () => {
    expect(HOLD_BATCH_SIZE).toBe(200);
    // 450 accounts: 250 unpaid admin-invite rows (tier), 200 unpaid friends.
    const lineage: BusinessOsAccountHoldFactsRow[] = [];
    const grants: Record<string, BusinessOsInviteGrantKind> = {};
    for (let i = 0; i < 450; i += 1) {
      if (i < 250) {
        lineage.push({ account_id: uuid(i), invite_id: inviteOf(i), source: 'admin_invite', first_paid_at: null });
        grants[inviteOf(i)] = 'tier';
      } else {
        lineage.push({ account_id: uuid(i), invite_id: inviteOf(i), source: 'account_invite', first_paid_at: null });
      }
    }
    const { readers, lineageBatches, inviteBatches } = world(lineage, grants);
    const batch = await readAwaitingPaymentAccounts(lineage.map((row) => row.account_id), readers);
    expect(lineageBatches.map((ids) => ids.length)).toEqual([200, 200, 50]);
    // R-3: the 200 friends are decided on lineage alone; only the 250 admin rows are read.
    expect(inviteBatches.map((ids) => ids.length)).toEqual([200, 50]);
    expect(inviteBatches.flat().every((id) => grants[id] === 'tier')).toBe(true);
    expect(batch.ok && batch.held.size).toBe(450);
  });

  it('a friend-only set never reads an invite; an empty set reads nothing', async () => {
    const { readers, inviteBatches, lineageBatches } = world(
      [{ account_id: uuid(1), invite_id: inviteOf(1), source: 'account_invite', first_paid_at: null }],
      {}
    );
    expect(await readAwaitingPaymentAccounts([uuid(1)], readers)).toEqual({ ok: true, held: new Set([uuid(1)]) });
    expect(inviteBatches).toEqual([]);
    expect(await readAwaitingPaymentAccounts([], readers)).toEqual({ ok: true, held: new Set() });
    expect(lineageBatches).toHaveLength(1);
  });

  it('duplicate ids are read once', async () => {
    const { readers, lineageBatches } = world([], {});
    await readAwaitingPaymentAccounts([uuid(1), uuid(1), uuid(2)], readers);
    expect(lineageBatches).toEqual([[uuid(1), uuid(2)]]);
  });
});

describe('a failed read is { ok: false }, never "nobody is held"', () => {
  const held = [{ account_id: uuid(1), invite_id: inviteOf(1), source: 'admin_invite' as const, first_paid_at: null }];

  it.each([
    ['the lineage read errors', 'lineage', 'error'],
    ['the lineage read throws', 'lineage', 'throw'],
    ['the invite read errors', 'invites', 'error'],
    ['the invite read throws', 'invites', 'throw'],
  ] as const)('%s', async (_label, which, how) => {
    const { readers } = world(held, { [inviteOf(1)]: 'tier' });
    const failing = async () => {
      if (how === 'throw') throw new Error('network');
      return { data: null, error: new Error('timeout') };
    };
    if (which === 'lineage') readers.lineage.findHoldFactsForAccountsForAdmin = jest.fn(failing);
    else readers.invites.findGrantKindsByIdsForAdmin = jest.fn(failing);
    expect(await readAwaitingPaymentAccounts([uuid(1)], readers)).toEqual({ ok: false });
  });

  it('a failure in the SECOND lineage batch still fails the whole answer', async () => {
    const { readers } = world([], {});
    let call = 0;
    readers.lineage.findHoldFactsForAccountsForAdmin = jest.fn(async () => {
      call += 1;
      return call === 2 ? { data: null, error: new Error('timeout') } : { data: [], error: null };
    });
    const ids = Array.from({ length: 250 }, (_v, i) => uuid(i));
    expect(await readAwaitingPaymentAccounts(ids, readers)).toEqual({ ok: false });
  });
});

describe('SA C-8: no cycle with the entitlements module', () => {
  it('paymentHoldBatch.ts imports nothing from the entitlements module, and repositories as types only', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'paymentHoldBatch.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/business-os\/entitlements/);
    const repositoryImports = [...code.matchAll(/^import\s+(type\s+)?[^;]*from\s+'@\/lib\/repositories\/[^']+';/gm)];
    expect(repositoryImports.length).toBeGreaterThan(0);
    expect(repositoryImports.every((match) => match[1] === 'type ')).toBe(true);
    expect(code).not.toMatch(/\breadPaymentHold\s*\(/);
  });
});
