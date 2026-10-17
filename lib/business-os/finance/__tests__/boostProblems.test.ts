/**
 * Block A, "Our payment problems (boosts)", and held now (finance & business
 * health slice 4b.2, FR-4B-4, FR-4B-12, S4-FR-15, S4-FR-17): AC-102, AC-219
 * (held now, the same whatever the window), AC-221 (the unpaid-events note),
 * AC-227 (the start dates) and the K-5 measurement.
 */

import { buildBoostProblems, type BoostAttentionInput } from '../boostProblems';

let seq = 0;
function row(extra: Partial<BoostAttentionInput> = {}): BoostAttentionInput {
  seq += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    user_id: '11111111-1111-4111-8111-111111111111',
    status: 'disputed',
    currency: 'USD',
    amount_total_minor: 1000,
    amount_refunded_minor: 200,
    status_changed_at: '2026-10-05T10:00:00.000Z',
    disputeOpenedAt: '2026-10-04T09:00:00.000Z',
    ...extra,
  };
}

const attention = (rows: BoostAttentionInput[], reachedCeiling = false, openedDates: 'read' | 'failed' = 'read') => ({
  rows,
  reachedCeiling,
  openedDates,
});
const build = (rows: BoostAttentionInput[], opts: { ceiling?: boolean; dates?: 'read' | 'failed' } = {}) =>
  buildBoostProblems({ attention: attention(rows, opts.ceiling, opts.dates), eventsOnUnpaidPurchases: 0, overTotal: 0 });

describe('AC-102 / AC-219: open disputes (held now) and purchases not credited, per currency', () => {
  it('held now = total minus refunded; the oldest opened date; not credited with its total and oldest change', () => {
    const r = build([
      row(),
      row({ amount_total_minor: 500, amount_refunded_minor: 0, disputeOpenedAt: '2026-09-30T00:00:00.000Z' }),
      row({ status: 'flagged_mismatch', amount_total_minor: 700, status_changed_at: '2026-10-02T00:00:00.000Z', disputeOpenedAt: null }),
      row({ status: 'flagged_mismatch', amount_total_minor: 300, status_changed_at: '2026-10-01T00:00:00.000Z', disputeOpenedAt: null }),
    ]);
    expect(r.part.status).toBe('ok');
    expect(r.part.figures).toMatchObject({ empty: false, exact: true, openDisputes: 2, notCredited: 2, openedDates: 'read' });
    expect(r.part.figures!.lines).toEqual([
      {
        currency: 'USD',
        openDisputes: 2,
        held: 13,
        oldestDisputeOpenedAt: '2026-09-30T00:00:00.000Z',
        notCredited: 2,
        notCreditedAmount: 10,
        oldestNotCreditedAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    expect(r.heldNow).toEqual([{ currency: 'USD', disputes: 2, amountMinor: 1300 }]);
    expect(r.openDisputes).toEqual({ value: 2, exact: true });
  });

  it('per currency only: EUR and USD are two lines, never one total', () => {
    const r = build([row(), row({ currency: 'EUR' })]);
    expect(r.part.figures!.lines.map((l) => [l.currency, l.held])).toEqual([
      ['EUR', 8],
      ['USD', 8],
    ]);
    expect(r.heldNow!.map((l) => l.currency)).toEqual(['EUR', 'USD']);
  });

  it('nothing → empty, ok, held now an empty list, zero open disputes', () => {
    const r = build([]);
    expect(r.part).toEqual({
      status: 'ok',
      figures: expect.objectContaining({ empty: true, lines: [], openDisputes: 0, notCredited: 0 }),
    });
    expect(r.heldNow).toEqual([]);
    expect(r.openDisputes).toEqual({ value: 0, exact: true });
  });
});

describe('unreadable, ceiling, dates', () => {
  it('an unreadable amount → held Unknown on its line and partial; the dispute is still counted', () => {
    const r = build([row({ amount_refunded_minor: 2000 })]);
    expect(r.part.figures!.lines[0]).toMatchObject({ openDisputes: 1, held: null });
    expect(r.heldNow).toEqual([{ currency: 'USD', disputes: 1, amountMinor: null }]);
    expect(r.part.status).toBe('partial');
  });

  it('a flagged purchase with no recorded total → its amount Unknown, partial', () => {
    const r = build([row({ status: 'flagged_mismatch', amount_total_minor: null })]);
    expect(r.part.figures!.lines[0]).toMatchObject({ notCredited: 1, notCreditedAmount: null });
    expect(r.part.status).toBe('partial');
  });

  it('the ceiling → not exact (at least), K-5 measurement not exact, partial', () => {
    const r = build([row()], { ceiling: true });
    expect(r.part.figures!.exact).toBe(false);
    expect(r.openDisputes).toEqual({ value: 1, exact: false });
    expect(r.part.status).toBe('partial');
  });

  it('AC-227: the opened dates failed → dates null, partial; the count still stands', () => {
    const r = build([row({ disputeOpenedAt: null })], { dates: 'failed' });
    expect(r.part.figures!.lines[0].oldestDisputeOpenedAt).toBeNull();
    expect(r.part.figures!.openedDates).toBe('failed');
    expect(r.openDisputes!.value).toBe(1);
    expect(r.part.status).toBe('partial');
  });
});

describe('the read failed, and the event notes', () => {
  it('attention null → unknown, no held now, no K-5 measurement', () => {
    const r = buildBoostProblems({ attention: null, eventsOnUnpaidPurchases: 0, overTotal: 0 });
    expect(r).toMatchObject({ part: { status: 'unknown', figures: null }, heldNow: null, openDisputes: null });
  });

  it('AC-221: the unpaid-events count and the SA-Q74 count travel; unknown events make the block partial', () => {
    const known = buildBoostProblems({ attention: attention([]), eventsOnUnpaidPurchases: 2, overTotal: 1 });
    expect(known.part.figures).toMatchObject({ eventsOnUnpaidPurchases: 2, overTotal: 1 });
    const unknownEvents = buildBoostProblems({ attention: attention([]), eventsOnUnpaidPurchases: null, overTotal: null });
    expect(unknownEvents.part.status).toBe('partial');
  });
});
