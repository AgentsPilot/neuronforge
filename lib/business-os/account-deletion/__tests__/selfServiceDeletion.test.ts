/**
 * The self-service runners (data export DE-10b.2; SA V-1, V-2): the pre-check
 * mapping over a fake repository, and the delete reaching `runAccountAnonymise`
 * with no actor and the session email as its own confirmation.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import { errorKindFacts, runAccountDeletionCheck, runSelfAccountAnonymise } from '../selfServiceDeletion';
import {
  CleanupRpcError,
  type AnonymiseOutcome,
  type CleanupCheckResult,
} from '@/lib/repositories/TestAccountCleanupRepository';
import type { DeletionReceiptBase, DeletionReceiptInput } from '../receiptInput';

const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'jane@example.com';

const check = (patch: Partial<CleanupCheckResult> = {}): CleanupCheckResult => ({
  version: CLEANUP_FUNCTION_VERSION,
  verdict: 'OK',
  targetUserId: SUBJECT,
  blockers: [],
  notes: [],
  storageObjects: [],
  rows: [],
  serverMs: 4,
  ...patch,
});

const guard = (id: string, item = 'x', found = 1) => ({ guard: id, item, found, clears: 'how' });

function repo(result: { data: CleanupCheckResult | null; error: Error | null }) {
  const calls: unknown[] = [];
  return {
    calls,
    anonymiseCheck: jest.fn(async (input: unknown) => {
      calls.push(input);
      return result;
    }),
  };
}

describe('runAccountDeletionCheck', () => {
  it('OK → canDelete, no blockers, notes passed through; the session pair is what is checked', async () => {
    const fake = repo({ data: check({ notes: [guard('G-5', 'live money', 2), guard('G-14', 'consent', 3)] }), error: null });
    const outcome = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, fake);
    expect(fake.calls).toEqual([{ email: EMAIL, subject: SUBJECT }]);
    expect(outcome).toMatchObject({ kind: 'checked', canDelete: true, blockers: [], guards: [] });
    expect(outcome.kind === 'checked' && outcome.notes.map((n) => n.guard)).toEqual(['G-5', 'G-14']);
  });

  it('files only (G-12) → canDelete, and G-12 is never a blocker', async () => {
    const outcome = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: check({ verdict: 'BLOCKED', blockers: [guard('G-12')] }), error: null }));
    expect(outcome).toMatchObject({ kind: 'checked', canDelete: true, blockers: [] });
  });

  it('real blockers → the rows without G-12', async () => {
    const outcome = await runAccountDeletionCheck(
      { email: EMAIL, subject: SUBJECT },
      repo({ data: check({ verdict: 'BLOCKED', blockers: [guard('G-8'), guard('G-12')] }), error: null })
    );
    expect(outcome).toMatchObject({ kind: 'checked', canDelete: false, guards: ['G-8', 'G-12'] });
    expect(outcome.kind === 'checked' && outcome.blockers.map((b) => b.guard)).toEqual(['G-8']);
  });

  it('BLOCKED with no readable row, or another login → one unknown blocker (contact support)', async () => {
    const a = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: check({ verdict: 'BLOCKED' }), error: null }));
    expect(a).toMatchObject({ kind: 'checked', canDelete: false, blockers: [{ guard: 'unknown' }] });
    const b = await runAccountDeletionCheck(
      { email: EMAIL, subject: SUBJECT },
      repo({ data: check({ targetUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), error: null })
    );
    expect(b).toMatchObject({ kind: 'checked', canDelete: false, blockers: [{ guard: 'unknown' }] });
  });

  it('a function from another version → unavailable (R-6)', async () => {
    const outcome = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: check({ version: 'old' }), error: null }));
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'function_out_of_date', error: null });
  });

  it('not configured / refused secret → unavailable; any other error → failed', async () => {
    const a = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: null, error: new CleanupRpcError('not_authorised', '42501', 'no') }));
    expect(a).toMatchObject({ kind: 'unavailable', reason: 'not_authorised' });
    const b = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: null, error: new Error('boom') }));
    expect(b).toMatchObject({ kind: 'failed' });
  });
});

describe('runSelfAccountAnonymise', () => {
  it('no actor, the session email as confirmation, the receipt for the resolved login', async () => {
    const anonymiseCalls: Array<[unknown, string | null, DeletionReceiptInput]> = [];
    const ANONYMISED: AnonymiseOutcome = {
      kind: 'anonymised',
      version: CLEANUP_FUNCTION_VERSION,
      report: { receiptId: 'r', placeholderRef: '0123456789ab', receiptMode: 'anonymised', rowsRemoved: 1, tablesRemoved: 1, rowsBlanked: 0 },
      serverMs: 5,
    };
    const fake = {
      anonymiseCheck: jest.fn(async () => ({ data: check(), error: null })),
      emptyStorage: jest.fn(),
      anonymise: jest.fn(async (input: unknown, actor: string | null, receipt: DeletionReceiptInput) => {
        anonymiseCalls.push([input, actor, receipt]);
        return { data: ANONYMISED, error: null };
      }),
    };
    const prepare = jest.fn(async () => ({ origin: 'owner' }) as unknown as DeletionReceiptBase);
    const outcome = await runSelfAccountAnonymise({ email: EMAIL, subject: SUBJECT }, prepare, fake as never);
    expect(outcome.kind).toBe('anonymised');
    expect(prepare).toHaveBeenCalledWith(SUBJECT);
    expect(anonymiseCalls[0][0]).toEqual({ email: EMAIL, subject: SUBJECT, confirmEmail: EMAIL });
    expect(anonymiseCalls[0][1]).toBeNull();
    expect(fake.emptyStorage).not.toHaveBeenCalled();
  });
});

describe('errorKindFacts', () => {
  it('keeps the kind and code, never the message', () => {
    const facts = errorKindFacts(new CleanupRpcError('failed', 'P0001', 'jane@example.com leaked'));
    expect(facts).toEqual({ kind: 'failed', code: 'P0001', name: 'CleanupRpcError' });
    expect(JSON.stringify(errorKindFacts(new Error('jane@example.com')))).not.toContain('jane');
    expect(errorKindFacts('text')).toEqual({ kind: null, code: null, name: null });
  });
});
