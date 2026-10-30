/**
 * Anything the agents list shows, the agents list can control — and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * The list used to select on one tag (`business-os-automation`) and the control
 * guard checked the same tag, so the two agreed by coincidence. The list now
 * selects on the scheduling CONTRACT, so the mailbox channel appears on it —
 * and with the tag check still in place its pause and remove buttons would have
 * been drawn and then silently refused.
 *
 * A control that does nothing is worse than one that is absent: the owner
 * presses it, the row does not change, and there is nothing to read. So the
 * guard was widened to the same predicate the list selects on, and these tests
 * pin BOTH halves — that it admits what the list shows, and that widening it
 * did not turn it into no guard at all.
 *
 * The second half matters more. This is an authorization boundary on a
 * destructive control: an owner's prompt-written agents are not on this list and
 * must not be pausable from it, and no owner may touch another's.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findById = jest.fn();
const pause = jest.fn().mockResolvedValue({ data: {}, error: null });
const activate = jest.fn().mockResolvedValue({ data: {}, error: null });
const softDelete = jest.fn().mockResolvedValue({ data: true, error: null });
/* Resuming now moves `next_run` as well as the status, so the repository has
   to answer the write — see `resumingMovesTheClock`. */
const update = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('@/lib/repositories/AgentRepository', () => ({
  agentRepository: {
    findById: (...a: unknown[]) => findById(...a),
    pause: (...a: unknown[]) => pause(...a),
    activate: (...a: unknown[]) => activate(...a),
    softDelete: (...a: unknown[]) => softDelete(...a),
    update: (...a: unknown[]) => update(...a),
    findScheduled: jest.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: jest.fn().mockResolvedValue({ data: { language: 'en' }, error: null }),
  },
}));

import { pauseAutomation, resumeAutomation } from '../install';

const OWNER = 'owner-1';
const AGENT = 'agent-1';

/**
 * What `findById` answers.
 *
 * It is scoped to the owner by the repository itself — `.eq('user_id', userId)`
 * — so another owner's agent comes back as NOT FOUND rather than as a row the
 * guard has to reason about. Modelled that way here, because that is the
 * mechanism the boundary actually rests on.
 */
function rowFor(overrides: Record<string, unknown> = {}) {
  return { data: { id: AGENT, mode: 'scheduled', deleted_at: null, ...overrides }, error: null };
}

beforeEach(() => jest.clearAllMocks());

describe('it admits every family the list shows', () => {
  it('an agent adopted from an insight', async () => {
    findById.mockResolvedValue(
      rowFor({ tags: ['business-os-automation', 'business-os-automation:chase_overdue_invoices'] })
    );

    expect(await pauseAutomation(OWNER, AGENT)).toBe(true);
    expect(pause).toHaveBeenCalledWith(AGENT, OWNER, 'Paused by the owner');
  });

  it('the mailbox channel — which the tag check refused', async () => {
    /* The regression. It carries `inbox-enquiries`, never
       `business-os-automation`, so the old guard returned false and the
       owner's press did nothing. */
    findById.mockResolvedValue(rowFor({ tags: ['inbox-enquiries', 'inbox-enquiries:google-mail'] }));

    expect(await pauseAutomation(OWNER, AGENT)).toBe(true);
    expect(await resumeAutomation(OWNER, AGENT)).toBe(true);
  });

  it('an agent with no tags at all, if it is scheduled', async () => {
    /* The list selects on the contract, so a prompt-written agent somebody put
       on a schedule appears there too — and must be controllable from there. */
    findById.mockResolvedValue(rowFor({ tags: [] }));

    expect(await pauseAutomation(OWNER, AGENT)).toBe(true);
  });
});

describe('widening it did not make it no guard', () => {
  it('refuses an on_demand agent, which the list never shows', async () => {
    /*
     * The important half. Eighty-three of this account's agents are
     * `on_demand`: written from a prompt, run when asked, absent from this
     * list. A guard that admitted them would let one surface pause agents it
     * never offered to control.
     */
    findById.mockResolvedValue(rowFor({ mode: 'on_demand', tags: [] }));

    expect(await pauseAutomation(OWNER, AGENT)).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it('refuses a soft-deleted agent', async () => {
    /* Removal is a soft delete, so the row survives for its history. Pausing
       something already removed is not a state anyone asked for. */
    findById.mockResolvedValue(rowFor({ deleted_at: '2026-10-01T00:00:00Z' }));

    expect(await pauseAutomation(OWNER, AGENT)).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it('refuses another owner agent, because the lookup never finds it', async () => {
    /*
     * CROSS-TENANT. `findById` applies `.eq('user_id', userId)`, so another
     * owner's agent is simply absent — the guard never sees a row to judge.
     *
     * Tested with a mock because the live account is the only one with a
     * scheduled agent, so a live probe could not exercise this at all. That is
     * exactly the case worth pinning rather than assuming.
     */
    findById.mockResolvedValue({ data: null, error: null });

    expect(await pauseAutomation(OWNER, AGENT)).toBe(false);
    expect(await resumeAutomation(OWNER, AGENT)).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('refuses when the lookup itself failed', async () => {
    /* Fails closed. A guard that cannot read is not a guard that permits. */
    findById.mockResolvedValue({ data: null, error: new Error('database unreachable') });

    expect(await pauseAutomation(OWNER, AGENT)).toBe(false);
  });

  it('passes the owner id to the lookup, never trusting the caller', async () => {
    findById.mockResolvedValue(rowFor());
    await pauseAutomation(OWNER, AGENT);

    expect(findById).toHaveBeenCalledWith(AGENT, OWNER);
  });
});
