/**
 * Fan-out safety tests.
 *
 * Fan-out is the only thing in this system that can do something genuinely
 * irreversible to many people at once. Everything else is recoverable; emailing
 * 200 clients is not.
 *
 * These assert what it REFUSES, and that previewing performs nothing. No
 * network and no database: the email transport is mocked so a bug in these
 * tests cannot send anything.
 */

import { executeForEach } from '../mutate/ForEachExecutor';
import { BizQLValidationError, type ForEachQuery, type QueryRow } from '../types';

// Mocked so no test can ever reach a real provider.
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: jest.fn(async () => ({ sent: true, provider: 'resend' as const })),
}));

// The action log needs a database; stub it so these stay pure. Its real
// guarantee is a UNIQUE index, not application code, so mocking it here loses
// nothing — the behaviour under test is how the executor REACTS to a lost claim.
//
// A single shared stub, not a fresh object per call: the executor resolves
// getActionLog() itself, so a per-call object would make overrides invisible
// to it.
const actionLogStub = {
  claim: jest.fn(async () => ({ proceed: true, entryId: 'entry-1' })),
  complete: jest.fn(async () => undefined),
  countToday: jest.fn(async () => 0),
  dailyLimit: jest.fn(async () => 200),
  isAvailable: () => true,
};

jest.mock('../mutate/ActionLog', () => ({
  getActionLog: () => actionLogStub,
  idempotencyKey: (p: string, s: string, i?: string) => `${p}|${s}|${i}`,
}));

import { sendEmail } from '@/lib/notifications/emailTransport';

const CTX = { userId: '11111111-1111-1111-1111-111111111111', consumer: 'chat' as const };
const OPTIONS = { planId: 'plan-1' };

const rows = (n: number): QueryRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    email: `person${i}@example.com`,
    first_name: `Person${i}`,
  }));

const emailStep = (over = 's1'): ForEachQuery => ({
  id: 's2',
  op: 'for_each',
  over,
  entity: 'contacts',
  action: 'send',
  params: {
    to: { $item: 'email' },
    subject: 'Your intake form',
    body: 'Please fill this in.',
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  (sendEmail as jest.Mock).mockResolvedValue({ sent: true, provider: 'resend' });
  actionLogStub.claim.mockResolvedValue({ proceed: true, entryId: 'entry-1' });
  actionLogStub.countToday.mockResolvedValue(0);
  actionLogStub.dailyLimit.mockResolvedValue(200);
});

describe('fan-out — what it refuses', () => {
  it('refuses an action the catalog has not opted into bulk', async () => {
    // allowBulk defaults to false, so a new action is never accidentally
    // fannable just because it exists.
    await expect(
      executeForEach(
        { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'update' },
        rows(3),
        CTX,
        OPTIONS
      )
    ).rejects.toThrow(/may not be applied in bulk/);
  });

  it('refuses to bulk-delete, whatever the row count', async () => {
    await expect(
      executeForEach(
        { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'delete' },
        rows(1),
        CTX,
        OPTIONS
      )
    ).rejects.toThrow(/may not be applied in bulk/);
  });

  it('refuses an unknown action', async () => {
    await expect(
      executeForEach(
        { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'nuke' },
        rows(1),
        CTX,
        OPTIONS
      )
    ).rejects.toThrow(/no action 'nuke'/);
  });

  it('REFUSES rather than truncating when over the cap', async () => {
    // Quietly doing the first 100 of 150 would report success while leaving a
    // third of the job undone, and the user would have no way to know.
    await expect(executeForEach(emailStep(), rows(150), CTX, OPTIONS)).rejects.toThrow(
      /above the 100 limit/
    );

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects an $item reference to a field that does not exist', async () => {
    const step = emailStep();
    step.params = { ...step.params, to: { $item: 'not_a_field' } };

    const result = await executeForEach(step, rows(2), CTX, OPTIONS);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('fan-out — preview', () => {
  it('sends nothing on a dry run', async () => {
    const result = await executeForEach(emailStep(), rows(5), CTX, {
      ...OPTIONS,
      dryRun: true,
    });

    expect(result.applied).toBe(false);
    expect(result.attempted).toBe(5);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('shows who would be contacted, so the user confirms something concrete', async () => {
    const result = await executeForEach(emailStep(), rows(3), CTX, {
      ...OPTIONS,
      dryRun: true,
    });

    expect(result.items.map((i) => i.target)).toEqual([
      'person0@example.com',
      'person1@example.com',
      'person2@example.com',
    ]);
  });
});

describe('fan-out — execution', () => {
  it('sends to every row and reports the count', async () => {
    const result = await executeForEach(emailStep(), rows(3), CTX, OPTIONS);

    expect(result.applied).toBe(true);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it('reports partial failure honestly rather than averaging it away', async () => {
    // 2 of 3 succeeding must be reported as exactly that, with the failure
    // identified — not rounded up to "done".
    (sendEmail as jest.Mock)
      .mockResolvedValueOnce({ sent: true, provider: 'resend' })
      .mockResolvedValueOnce({ sent: false, provider: 'resend', error: 'bounced' })
      .mockResolvedValueOnce({ sent: true, provider: 'resend' });

    const result = await executeForEach(emailStep(), rows(3), CTX, OPTIONS);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.items.find((i) => !i.ok)?.error).toBe('bounced');
  });

  it('skips a row with no email address instead of counting it as sent', async () => {
    const withMissing: QueryRow[] = [
      { id: 'a', email: 'a@example.com' },
      { id: 'b', email: null },
    ];

    const result = await executeForEach(emailStep(), withMissing, CTX, OPTIONS);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items.find((i) => i.id === 'b')?.error).toMatch(/no email address/);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('refuses to send without a subject or body', async () => {
    const step = emailStep();
    step.params = { to: { $item: 'email' }, subject: '', body: '' };

    const result = await executeForEach(step, rows(2), CTX, OPTIONS);

    expect(result.succeeded).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('fan-out — idempotency', () => {
  it('skips an item already claimed, and does not double-send', async () => {
    // Simulates a double-clicked confirmation or a retried invocation: the
    // second attempt loses the UNIQUE insert and must not send again.
    actionLogStub.claim
      .mockResolvedValueOnce({ proceed: true, entryId: 'e1' })
      .mockResolvedValueOnce({ proceed: false, reason: 'already_done' } as never)
      .mockResolvedValue({ proceed: true, entryId: 'e3' });

    const result = await executeForEach(emailStep(), rows(3), CTX, OPTIONS);

    expect(result.skipped).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
