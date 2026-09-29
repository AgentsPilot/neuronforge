/**
 * BusinessOsInviteRepository — one test per method (new-repository skill,
 * C-12), plus the two properties C-13 and C-3 rest on: the admin methods are
 * named for admin scope, and no reader ever selects `token_hash`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestError } from '@supabase/postgrest-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BUSINESS_OS_INVITE_ADMIN_COLUMNS,
  BUSINESS_OS_INVITE_LIST_LIMIT,
  BUSINESS_OS_INVITE_PUBLIC_COLUMNS,
  BUSINESS_OS_INVITE_REDEMPTION_COLUMNS,
  BusinessOsInviteRepository,
  safeDbError,
} from '../BusinessOsInviteRepository';
import type { CreateBusinessOsInviteInput } from '../types';

type Call = { method: string; args: unknown[] };

function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['insert', 'update', 'select', 'eq', 'is', 'or', 'gt', 'order', 'limit', 'single', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-10-01T12:00:00.000Z');
const CUTOFF = new Date('2026-10-01T11:58:00.000Z');
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const CODE_HASH = 'c'.repeat(64);

function input(): CreateBusinessOsInviteInput {
  return {
    token_hash: HASH,
    email: 'dana@example.com',
    invite_type: 'type-a',
    grant_kind: 'cohort',
    grant_id: 'grant-a',
    access_open_ended: true,
    access_months: null,
    issuer_admin_id: ADMIN,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: null,
    internal_reason: 'Design partner',
    link_expiry_days: 30,
    link_expires_at: '2026-10-31T12:00:00.000Z',
  };
}

beforeEach(() => {
  logged.length = 0;
});

describe('column constants', () => {
  it('the admin columns carry the Slice 1a existing-account stamp', () => {
    expect(BUSINESS_OS_INVITE_ADMIN_COLUMNS.split(', ')).toContain('opened_by_existing_account_at');
  });

  it('no select constant includes token_hash', () => {
    expect(BUSINESS_OS_INVITE_ADMIN_COLUMNS).not.toContain('token_hash');
    expect(BUSINESS_OS_INVITE_PUBLIC_COLUMNS).not.toContain('token_hash');
  });

  it('the public columns hold no email, issuer, reason or redeemer', () => {
    for (const column of ['email', 'issuer', 'reason', 'redeemed_account_id', 'revoked_by_admin_id']) {
      expect(BUSINESS_OS_INVITE_PUBLIC_COLUMNS).not.toContain(column);
    }
    expect(BUSINESS_OS_INVITE_PUBLIC_COLUMNS.split(', ')).toEqual([
      'id',
      'grant_kind',
      'grant_id',
      'access_open_ended',
      'access_months',
      'inviter_display_name',
      'language',
      'personal_note',
      'link_expires_at',
      'first_viewed_at',
      'revoked_at',
      'redeemed_at',
    ]);
  });
});

describe('createForAdmin', () => {
  it('inserts the explicit column object with issuer_kind admin, and selects the admin columns', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const result = await new BusinessOsInviteRepository(client).createForAdmin(input());

    expect(result).toEqual({ data: { id: ID }, error: null });
    expect(calls[0]).toEqual({ method: 'from', args: ['business_os_invites'] });
    const insert = calls.find((call) => call.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(insert).toEqual({ ...input(), issuer_kind: 'admin', issuer_account_id: null });
    expect(calls).toContainEqual({ method: 'select', args: [BUSINESS_OS_INVITE_ADMIN_COLUMNS] });
    expect(calls).toContainEqual({ method: 'single', args: [] });
  });

  it('never lets an extra property reach the row', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const tampered = { ...input(), issuer_kind: 'account', issuer_account_id: 'x', redeemed_at: 'now' } as CreateBusinessOsInviteInput;
    await new BusinessOsInviteRepository(client).createForAdmin(tampered);
    const insert = calls.find((call) => call.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(insert.issuer_kind).toBe('admin');
    expect(insert.issuer_account_id).toBeNull();
    expect(insert).not.toHaveProperty('redeemed_at');
  });

  it('returns { data: null, error } on a database error, and logs neither the hash nor the email', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'duplicate key' } });
    const result = await new BusinessOsInviteRepository(client).createForAdmin(input());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('duplicate key');
    const serialised = JSON.stringify(logged);
    expect(serialised).not.toContain(HASH);
    expect(serialised).not.toContain('dana@example.com');
  });
});

describe('listRecentForAdmin', () => {
  it('reads the admin columns, newest first, capped at the list limit', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const result = await new BusinessOsInviteRepository(client).listRecentForAdmin();
    expect(result).toEqual({ data: [{ id: ID }], error: null });
    expect(calls).toContainEqual({ method: 'select', args: [BUSINESS_OS_INVITE_ADMIN_COLUMNS] });
    expect(calls).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'limit', args: [BUSINESS_OS_INVITE_LIST_LIMIT] });
    expect(BUSINESS_OS_INVITE_LIST_LIMIT).toBe(500);
  });

  it('clamps a requested limit into 1..500 (Slice 1c ceiling)', async () => {
    for (const [requested, applied] of [
      [5000, 500],
      [501, 500],
      [500, 500],
      [0, 1],
      [-3, 1],
      [10, 10],
    ]) {
      const { client, calls } = recordingClient({ data: [], error: null });
      await new BusinessOsInviteRepository(client).listRecentForAdmin({ limit: requested });
      expect(calls).toContainEqual({ method: 'limit', args: [applied] });
    }
  });

  it('an empty table is an empty list, and an error is { data: null, error }', async () => {
    const empty = recordingClient({ data: null, error: null });
    expect((await new BusinessOsInviteRepository(empty.client).listRecentForAdmin()).data).toEqual([]);
    const failing = recordingClient({ data: null, error: { message: 'relation does not exist' } });
    const result = await new BusinessOsInviteRepository(failing.client).listRecentForAdmin();
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('relation does not exist');
  });
});

describe('findByIdForAdmin', () => {
  it('finds one row by id', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const result = await new BusinessOsInviteRepository(client).findByIdForAdmin(ID);
    expect(result).toEqual({ data: { id: ID }, error: null });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', ID] });
    expect(calls).toContainEqual({ method: 'maybeSingle', args: [] });
  });

  it('returns null data when there is no such invite, and an error on failure', async () => {
    const none = recordingClient({ data: null, error: null });
    expect(await new BusinessOsInviteRepository(none.client).findByIdForAdmin(ID)).toEqual({ data: null, error: null });
    const failing = recordingClient({ data: null, error: { message: 'boom' } });
    expect((await new BusinessOsInviteRepository(failing.client).findByIdForAdmin(ID)).error).toBeInstanceOf(Error);
  });
});

describe('revokeForAdmin', () => {
  it('is one conditional UPDATE: not accepted, not already revoked; sets the trio and updated_at', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const result = await new BusinessOsInviteRepository(client).revokeForAdmin({
      id: ID,
      adminId: ADMIN,
      reason: 'Wrong person',
      now: NOW,
      claimLeaseCutoff: CUTOFF,
    });

    expect(result).toEqual({ data: { id: ID }, error: null });
    // Slice 1b (I-2): a live signup claim blocks the revoke.
    expect(calls).toContainEqual({ method: 'or', args: [`claimed_at.is.null,claimed_at.lt."${CUTOFF.toISOString()}"`] });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      revoked_at: NOW.toISOString(),
      revoked_by_admin_id: ADMIN,
      revoke_reason: 'Wrong person',
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', ID] });
    expect(calls).toContainEqual({ method: 'is', args: ['redeemed_at', null] });
    expect(calls).toContainEqual({ method: 'is', args: ['revoked_at', null] });
    expect(calls).toContainEqual({ method: 'maybeSingle', args: [] });
  });

  it('returns null data when no row matched (already revoked, accepted, or missing)', async () => {
    const { client } = recordingClient({ data: null, error: null });
    const result = await new BusinessOsInviteRepository(client).revokeForAdmin({
      id: ID,
      adminId: ADMIN,
      reason: 'Wrong person',
      now: NOW,
      claimLeaseCutoff: CUTOFF,
    });
    expect(result).toEqual({ data: null, error: null });
  });

  it('returns the error on failure', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'boom' } });
    const result = await new BusinessOsInviteRepository(client).revokeForAdmin({
      id: ID,
      adminId: ADMIN,
      reason: 'Wrong person',
      now: NOW,
      claimLeaseCutoff: CUTOFF,
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });
});

describe('findByTokenHashForPublicView', () => {
  it('looks up by token_hash equality with the narrow column list', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const result = await new BusinessOsInviteRepository(client).findByTokenHashForPublicView(HASH);
    expect(result).toEqual({ data: { id: ID }, error: null });
    expect(calls).toContainEqual({ method: 'select', args: [BUSINESS_OS_INVITE_PUBLIC_COLUMNS] });
    expect(calls).toContainEqual({ method: 'eq', args: ['token_hash', HASH] });
    expect(calls).toContainEqual({ method: 'maybeSingle', args: [] });
  });

  it('no match is null data; an error is returned and the hash is not logged', async () => {
    const none = recordingClient({ data: null, error: null });
    expect(await new BusinessOsInviteRepository(none.client).findByTokenHashForPublicView(HASH)).toEqual({
      data: null,
      error: null,
    });
    const failing = recordingClient({ data: null, error: { message: 'timeout' } });
    const result = await new BusinessOsInviteRepository(failing.client).findByTokenHashForPublicView(HASH);
    expect(result.error?.message).toBe('timeout');
    expect(JSON.stringify(logged)).not.toContain(HASH);
  });
});

describe('findInviteeEmailForPublicCheck (Slice 1a, D-12)', () => {
  it('reads exactly the email column of the one row, by id', async () => {
    const { client, calls } = recordingClient({ data: { email: 'dana@example.com' }, error: null });
    const result = await new BusinessOsInviteRepository(client).findInviteeEmailForPublicCheck(ID);
    expect(result).toEqual({ data: 'dana@example.com', error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_invites'] },
      { method: 'select', args: ['email'] },
      { method: 'eq', args: ['id', ID] },
      { method: 'maybeSingle', args: [] },
    ]);
  });

  it('no row is null data; an error is returned and the email is never logged', async () => {
    const none = recordingClient({ data: null, error: null });
    expect(await new BusinessOsInviteRepository(none.client).findInviteeEmailForPublicCheck(ID)).toEqual({
      data: null,
      error: null,
    });

    const ok = recordingClient({ data: { email: 'dana@example.com' }, error: null });
    await new BusinessOsInviteRepository(ok.client).findInviteeEmailForPublicCheck(ID);
    const failing = recordingClient({ data: null, error: { message: 'timeout' } });
    const result = await new BusinessOsInviteRepository(failing.client).findInviteeEmailForPublicCheck(ID);
    expect(result.error?.message).toBe('timeout');
    expect(JSON.stringify(logged)).not.toContain('dana@example.com');
  });
});

describe('markOpenedByExistingAccount (Slice 1a, FR-8a, D-13)', () => {
  it('stamps only while the stamp is empty, sets updated_at, and reports true when this call set it', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const result = await new BusinessOsInviteRepository(client).markOpenedByExistingAccount(ID, NOW);
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      opened_by_existing_account_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', ID] });
    expect(calls).toContainEqual({ method: 'is', args: ['opened_by_existing_account_at', null] });
    expect(calls).toContainEqual({ method: 'select', args: ['id'] });
  });

  it('reports false when the stamp was already set (no row came back)', async () => {
    const { client } = recordingClient({ data: [], error: null });
    expect(await new BusinessOsInviteRepository(client).markOpenedByExistingAccount(ID, NOW)).toEqual({
      data: false,
      error: null,
    });
  });

  it('returns the error on failure', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'boom' } });
    const result = await new BusinessOsInviteRepository(client).markOpenedByExistingAccount(ID, NOW);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });
});

describe('Slice 1b: the signup methods (token-scoped, compare-and-swap)', () => {
  it('findByTokenHashForRedemption: token_hash equality, the redemption columns, never token_hash', async () => {
    const { client, calls } = recordingClient({ data: { id: ID }, error: null });
    const result = await new BusinessOsInviteRepository(client).findByTokenHashForRedemption(HASH);
    expect(result).toEqual({ data: { id: ID }, error: null });
    expect(calls).toContainEqual({ method: 'select', args: [BUSINESS_OS_INVITE_REDEMPTION_COLUMNS] });
    expect(calls).toContainEqual({ method: 'eq', args: ['token_hash', HASH] });
    expect(BUSINESS_OS_INVITE_REDEMPTION_COLUMNS).not.toContain('token_hash');
    expect(BUSINESS_OS_INVITE_REDEMPTION_COLUMNS.split(', ')).toEqual(
      expect.arrayContaining(['email', 'signup_code_hash', 'signup_code_attempts', 'claimed_at', 'claimed_account_id'])
    );
  });

  it('issueSignupCode: CAS on the observed send count AND last-sent time, pending, unexpired, no live claim; resets attempts', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const expiresAt = new Date('2026-10-01T12:10:00.000Z');
    const result = await new BusinessOsInviteRepository(client).issueSignupCode({
      id: ID,
      observedSentCount: 2,
      observedLastSentAt: '2026-10-01T11:00:00+00:00',
      claimLeaseCutoff: CUTOFF,
      codeHash: CODE_HASH,
      expiresAt,
      sentCount: 3,
      windowStartedAt: NOW,
      now: NOW,
    });
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      signup_code_hash: CODE_HASH,
      signup_code_expires_at: expiresAt.toISOString(),
      signup_code_attempts: 0,
      signup_code_sent_count: 3,
      signup_code_window_started_at: NOW.toISOString(),
      signup_code_last_sent_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['signup_code_sent_count', 2] });
    expect(calls).toContainEqual({ method: 'eq', args: ['signup_code_last_sent_at', '2026-10-01T11:00:00+00:00'] });
    expect(calls).toContainEqual({ method: 'is', args: ['redeemed_at', null] });
    expect(calls).toContainEqual({ method: 'is', args: ['revoked_at', null] });
    expect(calls).toContainEqual({ method: 'gt', args: ['link_expires_at', NOW.toISOString()] });
    expect(calls).toContainEqual({ method: 'or', args: [`claimed_at.is.null,claimed_at.lt."${CUTOFF.toISOString()}"`] });

    const lost = recordingClient({ data: [], error: null });
    expect(
      await new BusinessOsInviteRepository(lost.client).issueSignupCode({
        id: ID, observedSentCount: 2, observedLastSentAt: null, claimLeaseCutoff: CUTOFF, codeHash: CODE_HASH, expiresAt, sentCount: 3, windowStartedAt: NOW, now: NOW,
      })
    ).toEqual({ data: false, error: null });
  });

  it('issueSignupCode (MF-2): the first code ever compares last-sent IS NULL (null-safe)', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    await new BusinessOsInviteRepository(client).issueSignupCode({
      id: ID, observedSentCount: 0, observedLastSentAt: null, claimLeaseCutoff: CUTOFF, codeHash: CODE_HASH, expiresAt: NOW, sentCount: 1, windowStartedAt: NOW, now: NOW,
    });
    expect(calls).toContainEqual({ method: 'is', args: ['signup_code_last_sent_at', null] });
    expect(calls).not.toContainEqual(expect.objectContaining({ method: 'eq', args: ['signup_code_last_sent_at', expect.anything()] }));
  });

  it('countSignupCodeAttempt: CAS on the observed attempts AND the live code hash', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const result = await new BusinessOsInviteRepository(client).countSignupCodeAttempt({ id: ID, observedAttempts: 3, codeHash: CODE_HASH, now: NOW });
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({ signup_code_attempts: 4, updated_at: NOW.toISOString() });
    expect(calls).toContainEqual({ method: 'eq', args: ['signup_code_attempts', 3] });
    expect(calls).toContainEqual({ method: 'eq', args: ['signup_code_hash', CODE_HASH] });
  });

  it('claimForSignup (R-1): clears the code and claims, pending, not expired, no live claim, first claim => claimant IS NULL', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const result = await new BusinessOsInviteRepository(client).claimForSignup({
      id: ID,
      codeHash: CODE_HASH,
      accountId: ACCOUNT,
      observedClaimedAccountId: null,
      now: NOW,
      claimLeaseCutoff: CUTOFF,
    });
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      signup_code_hash: null,
      signup_code_expires_at: null,
      claimed_at: NOW.toISOString(),
      claimed_account_id: ACCOUNT,
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['signup_code_hash', CODE_HASH] });
    expect(calls).toContainEqual({ method: 'gt', args: ['link_expires_at', NOW.toISOString()] });
    expect(calls).toContainEqual({ method: 'or', args: [`claimed_at.is.null,claimed_at.lt."${CUTOFF.toISOString()}"`] });
    expect(calls).toContainEqual({ method: 'is', args: ['claimed_account_id', null] });
  });

  it('claimForSignup (D-dev-1, I-6): re-taking a lapsed claim compares the observed claimant', async () => {
    const stale = '44444444-4444-4444-8444-444444444444';
    const { client, calls } = recordingClient({ data: [], error: null });
    const result = await new BusinessOsInviteRepository(client).claimForSignup({
      id: ID,
      codeHash: CODE_HASH,
      accountId: stale,
      observedClaimedAccountId: stale,
      now: NOW,
      claimLeaseCutoff: CUTOFF,
    });
    expect(result).toEqual({ data: false, error: null });
    expect(calls).toContainEqual({ method: 'eq', args: ['claimed_account_id', stale] });
    expect(calls).not.toContainEqual({ method: 'is', args: ['claimed_account_id', null] });
  });

  it('releaseSignupClaim: only this claimant, only unredeemed', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    expect(await new BusinessOsInviteRepository(client).releaseSignupClaim(ID, ACCOUNT, NOW)).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      claimed_at: null,
      claimed_account_id: null,
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['claimed_account_id', ACCOUNT] });
    expect(calls).toContainEqual({ method: 'is', args: ['redeemed_at', null] });
  });

  it('recordRedemptionFailure (SA D-2): writes exactly the five fields plus updated_at, keyed on id and claimant', async () => {
    const { client, calls } = recordingClient({ data: [{ id: ID }], error: null });
    const result = await new BusinessOsInviteRepository(client).recordRedemptionFailure({
      id: ID,
      claimedAccountId: ACCOUNT,
      step: 'finalise',
      errorCode: '23505',
      errorMessage: 'duplicate key',
      failedAccountId: ACCOUNT,
      now: NOW,
    });
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      redemption_failed_at: NOW.toISOString(),
      redemption_failed_step: 'finalise',
      redemption_error_code: '23505',
      redemption_error_message: 'duplicate key',
      redemption_failed_account_id: ACCOUNT,
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', ID] });
    expect(calls).toContainEqual({ method: 'eq', args: ['claimed_account_id', ACCOUNT] });
  });

  it('the admin columns carry the claim and the FR-12a record', () => {
    for (const column of [
      'claimed_at',
      'claimed_account_id',
      'redemption_failed_at',
      'redemption_failed_step',
      'redemption_error_code',
      'redemption_error_message',
      'redemption_failed_account_id',
    ]) {
      expect(BUSINESS_OS_INVITE_ADMIN_COLUMNS.split(', ')).toContain(column);
    }
  });
});

describe('markFirstViewed', () => {
  it('stamps first_viewed_at only while it is null, and sets updated_at', async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    const result = await new BusinessOsInviteRepository(client).markFirstViewed(ID, NOW);
    expect(result).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      first_viewed_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', ID] });
    expect(calls).toContainEqual({ method: 'is', args: ['first_viewed_at', null] });
  });

  it('returns the error on failure', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'boom' } });
    const result = await new BusinessOsInviteRepository(client).markFirstViewed(ID, NOW);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
  });
});

describe('C-13: the service-role reason is written down, and the admin methods are named for admin scope', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'BusinessOsInviteRepository.ts'), 'utf8');

  it('the header states why the service role is used and who may reach the table', () => {
    expect(source).toContain('INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass)');
    expect(source).toContain('PLATFORM RECORDS');
    expect(source).toContain('issuer_account_id');
  });

  it('exposes exactly the admin-scoped and token-scoped methods, and nothing unscoped by another name', () => {
    const methods = Object.getOwnPropertyNames(BusinessOsInviteRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(
      [
        'createForAdmin',
        'findByIdForAdmin',
        'findByTokenHashForPublicView',
        'findInviteeEmailForPublicCheck',
        'listRecentForAdmin',
        'markFirstViewed',
        'markOpenedByExistingAccount',
        'revokeForAdmin',
        // Slice 1b: token-scoped signup methods, each a compare-and-swap.
        'findByTokenHashForRedemption',
        'issueSignupCode',
        'countSignupCodeAttempt',
        'claimForSignup',
        'releaseSignupClaim',
        'recordRedemptionFailure',
      ].sort()
    );
  });

  it('no method selects token_hash or `*`', () => {
    expect(source).not.toMatch(/\.select\(\s*['"]\*['"]/);
    expect(source).not.toMatch(/\.select\([^)]*token_hash/);
  });
});

describe('M-1 (C-3): a database error never carries row values into a log or a returned error', () => {
  const FAKE_HASH = 'f'.repeat(64);
  const FAKE_EMAIL = 'leak-check@example.com';

  function rowLeakingErrors(): Array<[string, PostgrestError]> {
    return [
      [
        'a CHECK violation',
        new PostgrestError({
          code: '23514',
          message: 'new row for relation "business_os_invites" violates check constraint "business_os_invites_email_normalised"',
          details: `Failing row contains (11111111-1111-4111-8111-111111111111, ${FAKE_HASH}, ${FAKE_EMAIL}, t, x).`,
          hint: `hint mentions ${FAKE_EMAIL}`,
        }),
      ],
      [
        'a unique violation',
        new PostgrestError({
          code: '23505',
          message: 'duplicate key value violates unique constraint "business_os_invites_token_hash_key"',
          details: `Key (token_hash)=(${FAKE_HASH}) already exists.`,
          hint: '',
        }),
      ],
    ];
  }

  const calls: Array<[string, (repo: BusinessOsInviteRepository) => Promise<{ data: unknown; error: Error | null }>]> = [
    ['createForAdmin', (repo) => repo.createForAdmin(input())],
    ['listRecentForAdmin', (repo) => repo.listRecentForAdmin()],
    ['findByIdForAdmin', (repo) => repo.findByIdForAdmin(ID)],
    ['revokeForAdmin', (repo) => repo.revokeForAdmin({ id: ID, adminId: ADMIN, reason: 'Wrong person', now: NOW, claimLeaseCutoff: CUTOFF })],
    ['findByTokenHashForRedemption', (repo) => repo.findByTokenHashForRedemption(HASH)],
    [
      'issueSignupCode',
      (repo) =>
        repo.issueSignupCode({ id: ID, observedSentCount: 0, observedLastSentAt: null, claimLeaseCutoff: CUTOFF, codeHash: CODE_HASH, expiresAt: NOW, sentCount: 1, windowStartedAt: NOW, now: NOW }),
    ],
    ['countSignupCodeAttempt', (repo) => repo.countSignupCodeAttempt({ id: ID, observedAttempts: 0, codeHash: CODE_HASH, now: NOW })],
    [
      'claimForSignup',
      (repo) =>
        repo.claimForSignup({ id: ID, codeHash: CODE_HASH, accountId: ACCOUNT, observedClaimedAccountId: null, now: NOW, claimLeaseCutoff: CUTOFF }),
    ],
    ['releaseSignupClaim', (repo) => repo.releaseSignupClaim(ID, ACCOUNT, NOW)],
    [
      'recordRedemptionFailure',
      (repo) =>
        repo.recordRedemptionFailure({ id: ID, claimedAccountId: ACCOUNT, step: 'finalise', errorCode: null, errorMessage: null, failedAccountId: ACCOUNT, now: NOW }),
    ],
    ['findByTokenHashForPublicView', (repo) => repo.findByTokenHashForPublicView(HASH)],
    ['markFirstViewed', (repo) => repo.markFirstViewed(ID, NOW)],
    ['findInviteeEmailForPublicCheck', (repo) => repo.findInviteeEmailForPublicCheck(ID)],
    ['markOpenedByExistingAccount', (repo) => repo.markOpenedByExistingAccount(ID, NOW)],
  ];

  for (const [label, dbError] of rowLeakingErrors()) {
    it.each(calls)(`%s, on ${label}: logs and returns only { code, message }`, async (_method, call) => {
      const { client } = recordingClient({ data: null, error: dbError });
      const result = await call(new BusinessOsInviteRepository(client));

      const logText = JSON.stringify(logged);
      expect(logged.length).toBeGreaterThan(0);
      expect(logText).not.toContain(FAKE_HASH);
      expect(logText).not.toContain(FAKE_EMAIL);
      expect(logText).toContain(dbError.code);

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).not.toBe(dbError);
      const returned = JSON.stringify({ ...result.error, message: result.error?.message, stack: result.error?.stack });
      expect(returned).not.toContain(FAKE_HASH);
      expect(returned).not.toContain(FAKE_EMAIL);
      expect(result.error).not.toHaveProperty('details');
      expect(result.error).not.toHaveProperty('hint');
      expect((result.error as Error & { code?: string }).code).toBe(dbError.code);
    });
  }

  it('safeDbError keeps exactly code and message', () => {
    const [, dbError] = rowLeakingErrors()[0];
    expect(safeDbError(dbError)).toEqual({ code: '23514', message: dbError.message });
    expect(safeDbError('boom')).toEqual({ code: null, message: 'Unknown database error' });
  });
});
