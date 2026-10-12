/**
 * Admin Layout Standard L-6, T-15: `countInvites`, the four state tiles' counts.
 *
 * Invented ids only (the screen's literal rule).
 */

import { countInvites } from '../components/InviteKpis';
import type { InviteRow, InviteState } from '../types';

function row(id: string, state: InviteState, overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id,
    email: `${id}@example.com`,
    inviteType: 'fixture-free',
    grantLabel: 'Fixture Free Plan',
    accessSummary: 'No end date',
    inviterDisplayName: 'Dana',
    language: 'en',
    createdAt: '2026-10-01T12:00:00.000Z',
    linkExpiryDays: 30,
    linkExpiresAt: '2026-10-31T12:00:00.000Z',
    state,
    firstViewedAt: null,
    revokedAt: null,
    revokeReason: null,
    redeemedAt: null,
    openedByExistingAccountAt: null,
    redeemedAccountId: null,
    level: null,
    redemptionStoppedHalfway: false,
    redemptionFailure: null,
    ...overrides,
  };
}

describe('countInvites', () => {
  it('counts one row per state', () => {
    expect(
      countInvites([row('p', 'pending'), row('a', 'accepted'), row('e', 'expired'), row('r', 'revoked')])
    ).toEqual({ pending: 1, accepted: 1, expired: 1, revoked: 1 });
  });

  it('an empty list counts nothing', () => {
    expect(countInvites([])).toEqual({ pending: 0, accepted: 0, expired: 0, revoked: 0 });
  });

  it('a pending row that also stopped halfway, or was opened by an existing account, counts once in Pending', () => {
    expect(
      countInvites([
        row('s', 'pending', { redemptionStoppedHalfway: true }),
        row('o', 'pending', { openedByExistingAccountAt: '2026-10-02T09:00:00.000Z' }),
      ])
    ).toEqual({ pending: 2, accepted: 0, expired: 0, revoked: 0 });
  });

  it('a state word this screen does not know counts nowhere (a newer server)', () => {
    // Typed through unknown, never `any` (SA L-6 S-3).
    const future = row('f', 'superseded' as unknown as InviteState);
    expect(countInvites([future, row('p', 'pending')])).toEqual({ pending: 1, accepted: 0, expired: 0, revoked: 0 });
  });

  it('the four state counts add up to the rows read when every state is known', () => {
    const rows = [
      row('1', 'pending'),
      row('2', 'pending'),
      row('3', 'pending'),
      row('4', 'accepted'),
      row('5', 'expired'),
      row('6', 'expired'),
      row('7', 'revoked'),
    ];
    const counts = countInvites(rows);
    expect(counts.pending + counts.accepted + counts.expired + counts.revoked).toBe(rows.length);
  });
});
