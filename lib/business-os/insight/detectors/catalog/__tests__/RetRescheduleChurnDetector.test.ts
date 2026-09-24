/**
 * A pattern in one client's behaviour, which is what the advisor is for.
 *
 * Deliberately NOT a chaser. The platform already handles the deterministic,
 * stuck-item cases through the gap registry and card-activated automations —
 * an unanswered enquiry, an unreturned intake form, an unpaid invoice. Nothing
 * here is stuck: no reply is owed and nothing is overdue. The finding is the
 * repetition itself, which no chaser can see.
 */

import { RetRescheduleChurnDetector } from '../RetRescheduleChurnDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Activity { contact_id: string | null; activity_date: string }

function mockSupabase(activities: Activity[], captured: { scopedByUser: boolean } = { scopedByUser: false }) {
  return {
    from(table: string) {
      if (table === 'crm_contacts') {
        const chain: Record<string, unknown> = {
          then: (r: (v: { data: unknown; error: null }) => unknown) =>
            r({ data: [{ id: 'c1', first_name: 'Dana', last_name: 'Levi' }], error: null }),
        };
        for (const m of ['select', 'in', 'order', 'limit', 'gte']) chain[m] = () => chain;
        chain.eq = (col: string) => {
          if (col === 'user_id') captured.scopedByUser = true;
          return chain;
        };
        return chain;
      }

      const chain: Record<string, unknown> = {
        then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: activities, error: null }),
      };
      for (const m of ['select', 'eq', 'gte', 'in', 'order', 'limit']) chain[m] = () => chain;
      return chain;
    },
  };
}

/** `n` reschedules by one contact, `daysAgo` and counting forward. */
function moves(contactId: string | null, n: number, daysAgo = 30): Activity[] {
  return Array.from({ length: n }, (_, i) => ({
    contact_id: contactId,
    activity_date: new Date(Date.now() - (daysAgo - i) * 86_400_000).toISOString(),
  }));
}

function detector(activities: Activity[], captured?: { scopedByUser: boolean }) {
  const d = new RetRescheduleChurnDetector(mockSupabase(activities, captured) as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('RetRescheduleChurnDetector', () => {
  it('reports a client who has moved three times', async () => {
    const result = await detector(moves('c1', 3)).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
    expect(result!.processParameters!.total_moves).toBe(3);
  });

  it('says nothing about two moves', async () => {
    // One is nothing and two is a bad month. Speaking at two would describe
    // ordinary rescheduling back to the owner as a problem.
    expect(await detector(moves('c1', 2)).evaluate('user-1')).toBeNull();
  });

  it('counts per client rather than in total', async () => {
    /*
     * Two people who each moved twice is not a churn signal; one person who
     * moved four times is. Summing across clients would report the first.
     */
    const result = await detector([...moves('c1', 2), ...moves('c2', 2)]).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('is more severe the more one client moves', async () => {
    const three = await detector(moves('c1', 3)).evaluate('user-1');
    const six = await detector(moves('c1', 6)).evaluate('user-1');

    expect(three!.severity).toBe('low');
    expect(six!.severity).toBe('high');
  });

  it('names the client rather than only counting them', async () => {
    const result = await detector(moves('c1', 4)).evaluate('user-1');

    const clients = result!.processParameters!.clients as Array<{ client: string | null; moves: number }>;
    expect(clients[0].client).toBe('Dana Levi');
    expect(clients[0].moves).toBe(4);
  });

  it('ignores an activity with no contact', async () => {
    expect(await detector(moves(null, 5)).evaluate('user-1')).toBeNull();
  });

  it('names no money', async () => {
    /*
     * A rescheduled appointment was not lost — it moved, and was very often
     * kept. Pricing the moves would invent a cancellation that has not
     * happened.
     */
    const result = await detector(moves('c1', 4)).evaluate('user-1');

    expect(result!.estimatedImpactUsd).toBeUndefined();
  });

  it('reports no percentage change', async () => {
    const result = await detector(moves('c1', 4)).evaluate('user-1');

    expect(result!.percentChange).toBe(0);
  });

  it('scopes the contact lookup to the user', async () => {
    // `.in('id', …)` alone is a cross-tenant read under the service role.
    const captured = { scopedByUser: false };
    await detector(moves('c1', 4), captured).evaluate('user-1');

    expect(captured.scopedByUser).toBe(true);
  });

  it('offers no button, because the action is a conversation', async () => {
    /*
     * `send_followup_nudge` is the only contact-shaped process and it sends a
     * generic follow-up, which would read as a chase to somebody who has done
     * nothing wrong.
     */
    const result = await detector(moves('c1', 4)).evaluate('user-1');

    expect(result!.pairedProcessId).toBeUndefined();
  });
});
