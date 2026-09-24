/**
 * A single write happens at most once per approval.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT ONLY A FAN-OUT PROBLEM
 *
 * `ActionLog.claim()` was wired into the fan-out alone, on the reasoning that
 * emailing forty people twice is the expensive mistake. A single write was left
 * to two application-level guards: the client's double-tap state, and the ORDER
 * of two server statements (clear the approval, then apply). Both are "have we
 * done this?" checks in application code, and those lose to concurrency — two
 * requests can each read the parked write before either clears it.
 *
 * So these assert the property, not the plumbing: given the same approval twice,
 * the second one performs NOTHING, and still tells the user it is done — because
 * it is.
 *
 * No database. The claim's real guarantee is a UNIQUE index, so stubbing the log
 * loses nothing: what is under test is how the caller REACTS to a lost claim.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { applyClaimedMutate, applyFrozenWrites } from '../mutate/applyWrites';
import type { MutateQuery } from '../types';

const actionLogStub = {
  // Typed parameters, so `mock.calls` stays inspectable: the key's SCOPE is the
  // property most of this file asserts, and it lives in the claim's arguments.
  claim: jest.fn(async (_args: { planId: string; stepId: string }) => ({
    proceed: true,
    entryId: 'entry-1' as string | null,
  })),
  complete: jest.fn(async () => undefined),
  countToday: jest.fn(async () => 0),
  dailyLimit: jest.fn(async () => 200),
  isAvailable: () => true,
};

jest.mock('../mutate/ActionLog', () => ({
  getActionLog: () => actionLogStub,
  idempotencyKey: (p: string, s: string, i?: string) => `${p}|${s}|${i}`,
}));

const executeMutateMock = jest.fn(
  async (_q: unknown, _c: unknown, _o: { dryRun?: boolean } = {}) => ({
    op: 'mutate',
    preview: 'mark as paid: INV-00002',
  })
);

jest.mock('../mutate/MutateExecutor', () => ({
  ...jest.requireActual('../mutate/MutateExecutor'),
  executeMutate: (...a: Parameters<typeof executeMutateMock>) => executeMutateMock(...a),
}));

jest.mock('@/lib/email/branding', () => ({ resolveEmailBranding: async () => ({}) }));

const CTX = { userId: '11111111-1111-1111-1111-111111111111', consumer: 'chat' as const };

const markPaid: MutateQuery = {
  id: 's1',
  op: 'mutate',
  entity: 'invoices',
  action: 'mark_paid',
  target: { id: 'aaaaaaaa-0000-0000-0000-000000000000' },
} as MutateQuery;

/** Did anything actually write? A dry run is not a write. */
const realWrites = () => executeMutateMock.mock.calls.filter((call) => !call[2]?.dryRun);

beforeEach(() => {
  jest.clearAllMocks();
  actionLogStub.claim.mockResolvedValue({ proceed: true, entryId: 'entry-1' });
});

describe('applying one write under a claim', () => {
  it('claims before it writes, and records the outcome', async () => {
    const result = await applyClaimedMutate({
      step: markPaid,
      ctx: CTX,
      planId: 'confirmation-1',
      stepId: 's1',
    });

    expect(actionLogStub.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: CTX.userId,
        planId: 'confirmation-1',
        stepId: 's1',
        entity: 'invoices',
        action: 'mark_paid',
        target: 'aaaaaaaa-0000-0000-0000-000000000000',
      })
    );
    expect(realWrites()).toHaveLength(1);
    expect(actionLogStub.complete).toHaveBeenCalledWith('entry-1', { status: 'succeeded' });
    expect(result).toEqual({ preview: 'mark as paid: INV-00002', skipped: false });
  });

  it('writes NOTHING when the claim is already held', async () => {
    // The second of two concurrent submissions of the same approval.
    actionLogStub.claim.mockResolvedValue({ proceed: false, reason: 'already_done' } as never);

    const result = await applyClaimedMutate({
      step: markPaid,
      ctx: CTX,
      planId: 'confirmation-1',
      stepId: 's1',
    });

    expect(realWrites()).toHaveLength(0);
    expect(result.skipped).toBe(true);
    // Reported as done, because it IS done — the first request did it. Telling
    // the user it failed would be a lie about their own records.
    expect(result.preview).toBe('mark as paid: INV-00002');
  });

  it('still names the action when the row has moved past this write', async () => {
    actionLogStub.claim.mockResolvedValue({ proceed: false, reason: 'already_done' } as never);
    // An invoice already marked paid cannot be previewed as being marked paid.
    executeMutateMock.mockRejectedValueOnce(new Error('invoice is already paid'));

    const result = await applyClaimedMutate({
      step: markPaid,
      ctx: CTX,
      planId: 'confirmation-1',
      stepId: 's1',
    });

    expect(result).toEqual({ preview: 'invoices.mark_paid', skipped: true });
    expect(realWrites()).toHaveLength(0);
  });

  it('marks the claim failed and rethrows when the write fails', async () => {
    executeMutateMock.mockRejectedValueOnce(new Error('row is locked'));

    await expect(
      applyClaimedMutate({ step: markPaid, ctx: CTX, planId: 'confirmation-1', stepId: 's1' })
    ).rejects.toThrow('row is locked');

    expect(actionLogStub.complete).toHaveBeenCalledWith('entry-1', {
      status: 'failed',
      error: 'row is locked',
    });
  });
});

describe('a confirmed write, submitted twice', () => {
  const apply = () =>
    applyFrozenWrites({
      steps: [markPaid],
      userId: CTX.userId,
      planId: 'confirmation-1',
      language: 'en',
    });

  it('performs the write once and reports it done both times', async () => {
    const first = await apply();
    expect(realWrites()).toHaveLength(1);
    expect(first.applied).toEqual(['mark as paid: INV-00002']);

    // The double-tapped Confirm button, or a retried request, arriving while the
    // first is still in flight — so the approval has not been cleared yet.
    actionLogStub.claim.mockResolvedValue({ proceed: false, reason: 'already_done' } as never);

    const second = await apply();
    expect(realWrites()).toHaveLength(1);
    expect(second.applied).toEqual(['mark as paid: INV-00002']);
  });

  it('scopes the key to the approval, so a NEW approval writes again', async () => {
    await apply();

    await applyFrozenWrites({
      steps: [markPaid],
      userId: CTX.userId,
      planId: 'confirmation-2',
      language: 'en',
    });

    // Asking for the same thing twice on purpose must still work twice. The key
    // says "this approval", not "this action, ever".
    expect(realWrites()).toHaveLength(2);
    expect(actionLogStub.claim.mock.calls.map((c) => c[0].planId)).toEqual([
      'confirmation-1',
      'confirmation-2',
    ]);
  });

  it('keys a step with no id of its own by its position', async () => {
    const noId = { op: 'mutate', entity: 'invoices', action: 'mark_paid', target: { id: 'x' } } as MutateQuery;

    await applyFrozenWrites({
      steps: [noId, noId],
      userId: CTX.userId,
      planId: 'confirmation-3',
      language: 'en',
    });

    // Two steps, two distinct keys. Sharing one would make the second step of a
    // multi-step approval silently skip.
    expect(actionLogStub.claim.mock.calls.map((c) => c[0].stepId)).toEqual([
      's0',
      's1',
    ]);
  });
});
