/**
 * The self-service runner (data export DE-10b.2; SA V-1, V-2): the pre-check
 * mapping over a fake repository. DL-1b (D-9, SA W-9): the self-service
 * anonymise runner was removed; the module must not export it any more, and
 * the check returns the raw guard rows, the verdict and the login match (W-4).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import * as runners from '../selfServiceDeletion';
import { errorKindFacts, runAccountDeletionCheck } from '../selfServiceDeletion';
import { CleanupRpcError, type CleanupCheckResult } from '@/lib/repositories/TestAccountCleanupRepository';

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

  it('DL-1b (W-4): the raw rows keep G-12, with the verdict and the login match', async () => {
    const filesOnly = await runAccountDeletionCheck({ email: EMAIL, subject: SUBJECT }, repo({ data: check({ verdict: 'BLOCKED', blockers: [guard('G-12', 'files', 3)] }), error: null }));
    expect(filesOnly).toMatchObject({ kind: 'checked', verdictBlocked: true, resolvedThisLogin: true, rows: [{ guard: 'G-12', item: 'files', found: 3 }] });
    const other = await runAccountDeletionCheck(
      { email: EMAIL, subject: SUBJECT },
      repo({ data: check({ targetUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), error: null })
    );
    expect(other).toMatchObject({ kind: 'checked', verdictBlocked: false, resolvedThisLogin: false, rows: [] });
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

describe('DL-1b (D-9, W-9): no self-service delete', () => {
  it('the module no longer exports the anonymise runner', () => {
    expect(Object.keys(runners).sort()).toEqual(['errorKindFacts', 'runAccountDeletionCheck']);
    expect((runners as Record<string, unknown>).runSelfAccountAnonymise).toBeUndefined();
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
