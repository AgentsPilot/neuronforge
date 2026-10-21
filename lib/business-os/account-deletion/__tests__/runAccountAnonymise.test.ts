/**
 * runAccountAnonymise (DE-10b.1, workplan §5, §7.4): the order G-3 -> check ->
 * version -> receipt -> storage -> anonymise, over a fake repository. Each case
 * proves which calls did NOT happen.
 */

import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import { runAccountAnonymise } from '../runAccountAnonymise';
import {
  CleanupRpcError,
  type AnonymiseOutcome,
  type CleanupCheckResult,
  type TestAccountCleanupRepository,
} from '@/lib/repositories/TestAccountCleanupRepository';
import type { DeletionReceiptBase, DeletionReceiptInput } from '../receiptInput';

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const INPUT = { email: 'jane@example.com', subject: TARGET, confirmEmail: 'JANE@example.com ' };
const RECEIPT = { email_fingerprint: 'f'.repeat(64) } as unknown as DeletionReceiptBase;

const check = (patch: Partial<CleanupCheckResult> = {}): CleanupCheckResult => ({
  version: CLEANUP_FUNCTION_VERSION,
  verdict: 'OK',
  targetUserId: TARGET,
  blockers: [],
  notes: [],
  storageObjects: [],
  rows: [],
  serverMs: 5,
  ...patch,
});

const ANONYMISED: AnonymiseOutcome = {
  kind: 'anonymised',
  version: CLEANUP_FUNCTION_VERSION,
  report: { receiptId: '99999999-9999-4999-8999-999999999999', placeholderRef: '999999999999', receiptMode: 'anonymised', rowsRemoved: 4, tablesRemoved: 2, rowsBlanked: 1 },
  serverMs: 9,
};

function fake(opts: { check?: CleanupCheckResult | Error; anonymise?: AnonymiseOutcome | Error; storage?: Error } = {}) {
  const events: string[] = [];
  const receipts: DeletionReceiptInput[] = [];
  const repo: Pick<TestAccountCleanupRepository, 'anonymiseCheck' | 'emptyStorage' | 'anonymise'> = {
    anonymiseCheck: async () => {
      events.push('check');
      const c = opts.check ?? check();
      return c instanceof Error ? { data: null, error: c } : { data: c, error: null };
    },
    emptyStorage: async (_id, objects) => {
      events.push(`storage:${objects.length}`);
      return opts.storage ? { data: null, error: opts.storage } : { data: { removed: objects.length, failed: 0 }, error: null };
    },
    anonymise: async (_input, _actor, receipt) => {
      events.push('anonymise');
      receipts.push(receipt);
      const a = opts.anonymise ?? ANONYMISED;
      return a instanceof Error ? { data: null, error: a } : { data: a, error: null };
    },
  };
  return { repo, events, receipts };
}

const prepare = (events?: string[]) => async () => {
  events?.push('receipt');
  return RECEIPT;
};

describe('runAccountAnonymise', () => {
  it('happy path: check, receipt, anonymise; the files count rides on the receipt', async () => {
    const { repo, events, receipts } = fake({
      check: check({ verdict: 'BLOCKED', blockers: [{ guard: 'G-12', item: 'files', found: 1, clears: '' }], storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }] }),
    });
    const outcome = await runAccountAnonymise(repo, INPUT, ADMIN, prepare(events));
    expect(outcome).toMatchObject({ kind: 'anonymised', targetUserId: TARGET, filesRemoved: 1, report: ANONYMISED.kind === 'anonymised' ? ANONYMISED.report : {} });
    expect(events).toEqual(['check', 'receipt', 'storage:1', 'anonymise']);
    expect(receipts[0]).toMatchObject({ email_fingerprint: 'f'.repeat(64), files_removed: 1 });
  });

  it('only info notes: proceeds, and reports them', async () => {
    const notes = [{ guard: 'G-14', item: 'no consent ledger rows', found: 3, clears: 'kept' }];
    const { repo, events } = fake({ check: check({ notes }) });
    const outcome = await runAccountAnonymise(repo, INPUT, ADMIN, prepare());
    expect(outcome).toMatchObject({ kind: 'anonymised', notes });
    expect(events).toEqual(['check', 'anonymise']);
  });

  it('G-3 mismatch: refused before the check', async () => {
    const { repo, events } = fake();
    const outcome = await runAccountAnonymise(repo, { ...INPUT, confirmEmail: 'other@example.com' }, ADMIN, prepare());
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'confirmation_mismatch', guards: ['G-3'] });
    expect(events).toEqual([]);
  });

  it('a blocking guard: refused, no receipt, no storage, no anonymise', async () => {
    const { repo, events } = fake({ check: check({ verdict: 'BLOCKED', blockers: [{ guard: 'G-8', item: 'stripe', found: 1, clears: '' }] }) });
    const outcome = await runAccountAnonymise(repo, INPUT, ADMIN, prepare(events));
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'blocked', guards: ['G-8'], filesRemovedThenRefused: false });
    expect(events).toEqual(['check']);
  });

  it('another function version: 503 before the receipt and storage (R-6)', async () => {
    const { repo, events } = fake({ check: check({ version: 'ffffffffffffffff' }) });
    expect(await runAccountAnonymise(repo, INPUT, ADMIN, prepare(events))).toMatchObject({ kind: 'unavailable', reason: 'function_out_of_date' });
    expect(events).toEqual(['check']);
  });

  it('the receipt cannot be prepared: failed, nothing removed', async () => {
    const { repo, events } = fake({ check: check({ storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }] }) });
    const outcome = await runAccountAnonymise(repo, INPUT, ADMIN, async () => {
      throw new Error('no facts');
    });
    expect(outcome).toMatchObject({ kind: 'failed', stage: 'receipt', filesRemoved: 0 });
    expect(events).toEqual(['check']);
  });

  it('storage fails: failed at storage, no anonymise', async () => {
    const { repo, events } = fake({
      check: check({ storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }] }),
      storage: new Error('storage down'),
    });
    expect(await runAccountAnonymise(repo, INPUT, ADMIN, prepare())).toMatchObject({ kind: 'failed', stage: 'storage' });
    expect(events).toEqual(['check', 'storage:1']);
  });

  it('a guard appears after the storage step (C2-11): files removed, account kept', async () => {
    const { repo } = fake({
      check: check({ storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }] }),
      anonymise: { kind: 'blocked', guards: ['G-6'], reason: 'BLOCKED, nothing was removed: G-6 no live plan' },
    });
    const outcome = await runAccountAnonymise(repo, INPUT, ADMIN, prepare());
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'blocked', guards: ['G-6'], filesRemoved: 1, filesRemovedThenRefused: true });
    if (outcome.kind === 'refused') expect(outcome.message).toMatch(/^Files removed, account kept: /);
  });

  it('42501 on the anonymise after storage: unavailable, with the files count', async () => {
    const { repo } = fake({
      check: check({ storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }] }),
      anonymise: new CleanupRpcError('not_authorised', '42501', 'not authorised'),
    });
    expect(await runAccountAnonymise(repo, INPUT, ADMIN, prepare())).toMatchObject({ kind: 'unavailable', reason: 'not_authorised', filesRemoved: 1 });
  });

  it('a check error of kind failed is a failed check', async () => {
    const { repo } = fake({ check: new CleanupRpcError('failed', '57014', 'timeout') });
    expect(await runAccountAnonymise(repo, INPUT, ADMIN, prepare())).toMatchObject({ kind: 'failed', stage: 'check' });
  });
});
