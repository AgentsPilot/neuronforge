/**
 * The redemption flow (Slice 1b): claim before create, and every invariant.
 *
 *   I-1  never deletes     I-2  a live claim beats revoke/expiry
 *   I-3  server-made id    I-4  release only on a positive "no such user"
 *   I-5  finalise retried once, then the claim is kept and recorded
 *   I-6  a lapsed claim is re-taken with the SAME id
 *
 * plus SA D-1 (live claim → signup_in_progress before any code check), D-2
 * (the scrubbed failure record, AC-5a), D-dev-1/2/3, AC-5/AC-6/AC-8, and the
 * tenant-isolation assertions (the account id, email and grant never come from
 * the request).
 *
 * The fake world below behaves like the database: compare-and-swap updates
 * that report whether they matched, and a finalise that is re-run safe.
 */

import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInviteRedemptionView } from '@/lib/repositories/types';

import { completeSignup, requestSignupCode, type RedemptionAuditEntry, type RedemptionDeps } from '../inviteRedemption';
import { generateInviteToken, hashInviteToken } from '../inviteToken';
import { hashSignupCode } from '../signupCode';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'invitee@example.com';
const PASSWORD = 'correct horse battery';
const CODE = '482913';
const NEW_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = generateInviteToken();
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function inviteRow(overrides: Partial<BusinessOsInviteRedemptionView> = {}): BusinessOsInviteRedemptionView {
  return {
    id: INVITE_ID,
    email: EMAIL,
    invite_type: 'champion',
    issuer_kind: 'admin',
    grant_kind: 'cohort',
    grant_id: 'champion',
    access_open_ended: true,
    access_months: null,
    language: 'en',
    link_expires_at: at(24 * 3600_000),
    revoked_at: null,
    redeemed_at: null,
    signup_code_hash: hashSignupCode(INVITE_ID, CODE),
    signup_code_expires_at: at(5 * 60_000),
    signup_code_attempts: 0,
    signup_code_sent_count: 1,
    signup_code_window_started_at: at(-60_000),
    signup_code_last_sent_at: at(-60_000),
    claimed_at: null,
    claimed_account_id: null,
    ...overrides,
  };
}

interface WorldOptions {
  row?: BusinessOsInviteRedemptionView | null;
  emailHasAccount?: boolean;
  emailHasAccountError?: boolean;
  /** What createConfirmedUser does. */
  create?: 'ok' | 'mismatch' | 'email_exists' | 'weak_password' | 'other';
  /** Whether a user exists at the claimed id when asked (true/false/'error'). */
  userExists?: boolean | 'error';
  /** How many finalise calls fail before one succeeds (Infinity: never). */
  finaliseFailures?: number;
  finaliseReturnsNull?: boolean;
  sendFails?: boolean;
  lostCas?: 'count' | 'claim' | 'issue';
}

function world(options: WorldOptions = {}) {
  let row = options.row === undefined ? inviteRow() : options.row;
  const calls: string[] = [];
  const audits: RedemptionAuditEntry[] = [];
  const logs: unknown[] = [];
  const recorded: Array<Record<string, unknown>> = [];
  const released: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const finalised: Array<Record<string, unknown>> = [];
  const sent: Array<{ to: string; code: string; language: string }> = [];
  let finaliseFailuresLeft = options.finaliseFailures ?? 0;

  const deps: RedemptionDeps = {
    invites: {
      findByTokenHashForRedemption: jest.fn(async (hash: string) => {
        calls.push('find');
        return { data: row && hash === hashInviteToken(TOKEN) ? { ...row } : null, error: null };
      }),
      issueSignupCode: jest.fn(async (input) => {
        calls.push('issue');
        if (
          options.lostCas === 'issue' ||
          !row ||
          row.signup_code_sent_count !== input.observedSentCount ||
          row.signup_code_last_sent_at !== input.observedLastSentAt
        ) {
          return { data: false, error: null };
        }
        row = {
          ...row,
          signup_code_hash: input.codeHash,
          signup_code_expires_at: input.expiresAt.toISOString(),
          signup_code_attempts: 0,
          signup_code_sent_count: input.sentCount,
          signup_code_window_started_at: input.windowStartedAt.toISOString(),
          signup_code_last_sent_at: input.now.toISOString(),
        };
        return { data: true, error: null };
      }),
      countSignupCodeAttempt: jest.fn(async (input) => {
        calls.push('count');
        if (options.lostCas === 'count' || !row || row.signup_code_attempts !== input.observedAttempts || row.signup_code_hash !== input.codeHash) {
          return { data: false, error: null };
        }
        row = { ...row, signup_code_attempts: input.observedAttempts + 1 };
        return { data: true, error: null };
      }),
      claimForSignup: jest.fn(async (input) => {
        calls.push('claim');
        if (options.lostCas === 'claim' || !row || row.signup_code_hash !== input.codeHash || row.claimed_account_id !== input.observedClaimedAccountId) {
          return { data: false, error: null };
        }
        row = { ...row, signup_code_hash: null, signup_code_expires_at: null, claimed_at: input.now.toISOString(), claimed_account_id: input.accountId };
        return { data: true, error: null };
      }),
      releaseSignupClaim: jest.fn(async (id: string, accountId: string) => {
        calls.push('release');
        released.push(accountId);
        if (row && row.claimed_account_id === accountId) row = { ...row, claimed_at: null, claimed_account_id: null };
        return { data: true, error: null };
      }),
      recordRedemptionFailure: jest.fn(async (input) => {
        calls.push('record');
        recorded.push(input as unknown as Record<string, unknown>);
        return { data: true, error: null };
      }),
      markOpenedByExistingAccount: jest.fn(async () => {
        calls.push('stamp');
        return { data: true, error: null };
      }),
    },
    accounts: {
      emailHasAccount: jest.fn(async (email: string) => {
        calls.push(`emailHasAccount:${email}`);
        if (options.emailHasAccountError) return { data: null, error: new Error('lookup failed') };
        return { data: options.emailHasAccount === true, error: null };
      }),
      createConfirmedUser: jest.fn(async (input) => {
        calls.push('create');
        created.push(input as unknown as Record<string, unknown>);
        switch (options.create ?? 'ok') {
          case 'ok':
            return { ok: true as const, id: input.id };
          case 'mismatch':
            return { ok: true as const, id: '99999999-9999-4999-8999-999999999999' };
          case 'email_exists':
            return { ok: false as const, kind: 'email_exists' as const, code: 'email_exists', message: `A user with this email address (${EMAIL}) has already been registered` };
          case 'weak_password':
            return { ok: false as const, kind: 'weak_password' as const, code: 'weak_password', message: 'weak' };
          default:
            return { ok: false as const, kind: 'other' as const, code: 'unexpected_failure', message: `timeout creating ${EMAIL}` };
        }
      }),
      findUserExists: jest.fn(async () => {
        calls.push('findUser');
        if (options.userExists === 'error') return { data: null, error: new Error('lookup failed') };
        return { data: options.userExists === true, error: null };
      }),
    },
    finalise: jest.fn(async (input) => {
      calls.push('finalise');
      finalised.push(input as unknown as Record<string, unknown>);
      if (finaliseFailuresLeft > 0) {
        finaliseFailuresLeft -= 1;
        return { data: null, error: Object.assign(new Error(`insert failed for ${EMAIL}`), { code: '23505' }) };
      }
      if (options.finaliseReturnsNull) return { data: null, error: null };
      return { data: input.inviteId, error: null };
    }),
    sendCode: jest.fn(async (input) => {
      calls.push('send');
      sent.push(input);
      return { sent: !options.sendFails };
    }),
    audit: jest.fn(async (entry: RedemptionAuditEntry) => {
      audits.push(entry);
    }),
    config: getEntitlementConfig(),
    now: () => NOW,
    newAccountId: () => NEW_ID,
    logger: {
      info: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    },
  };

  return {
    deps,
    calls,
    audits,
    logs,
    recorded,
    released,
    created,
    finalised,
    sent,
    row: () => row,
  };
}

const complete = (deps: RedemptionDeps, overrides: Partial<{ token: string; signupCode: string; password: string }> = {}) =>
  completeSignup({ token: TOKEN, signupCode: CODE, password: PASSWORD, ...overrides }, deps);

/** Nothing sensitive in the audit entries, the failure records or the logs (AC-5a, T-7). */
function expectNoSecrets(w: ReturnType<typeof world>) {
  const text = JSON.stringify({ audits: w.audits, recorded: w.recorded, logs: w.logs });
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(hashInviteToken(TOKEN));
  expect(text).not.toContain(CODE);
  expect(text).not.toContain(PASSWORD);
}

describe('the happy path', () => {
  it('counts, compares, claims for a server-made id, creates that exact account, finalises once, audits', async () => {
    const w = world();
    const outcome = await complete(w.deps);

    expect(outcome).toEqual({ ok: true, email: EMAIL, accountId: NEW_ID, inviteId: INVITE_ID });
    expect(w.calls).toEqual([
      'find',
      `emailHasAccount:${EMAIL}`,
      'count',
      'claim',
      'create',
      'finalise',
    ]);
    // I-3 / L-1: the id is the server's, the email is the row's, nothing else reaches the auth user.
    expect(w.created).toEqual([{ id: NEW_ID, email: EMAIL, password: PASSWORD }]);
    expect(w.finalised).toEqual([{ inviteId: INVITE_ID, accountId: NEW_ID, email: EMAIL, cohort: 'champion' }]);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEEMED', 'BOS_INVITE_PLAN_PROVISIONED']);
    expect(w.audits.every((entry) => entry.accountId === NEW_ID && entry.inviteId === INVITE_ID)).toBe(true);
    expectNoSecrets(w);
  });

  it('the claim is recorded on the invite BEFORE the account exists (R-1)', async () => {
    const w = world();
    await complete(w.deps);
    expect(w.calls.indexOf('claim')).toBeLessThan(w.calls.indexOf('create'));
    expect(w.row()?.claimed_account_id).toBe(NEW_ID);
  });

  it('I-1: nothing in the flow can delete a user (the accounts door has no delete)', () => {
    const w = world();
    expect(Object.keys(w.deps.accounts).sort()).toEqual(['createConfirmedUser', 'emailHasAccount', 'findUserExists']);
  });
});

describe('refusals before any claim', () => {
  it.each([
    ['a malformed token', 'abc'],
    ['an unknown token', generateInviteToken()],
  ])('%s is not_recognised, with no write', async (_label, token) => {
    const w = world();
    expect(await complete(w.deps, { token })).toEqual({ ok: false, kind: 'not_recognised' });
    expect(w.calls.filter((call) => call !== 'find')).toEqual([]);
  });

  it.each([
    ['used', { redeemed_at: at(-1000) }],
    ['revoked', { revoked_at: at(-1000) }],
    ['expired', { link_expires_at: NOW.toISOString() }],
    ['paid_invites_not_available', { grant_kind: 'tier' as const, grant_id: 'tier-x', access_open_ended: null }],
    ['unavailable', { grant_id: 'retired-cohort' }],
    ['unavailable', { invite_type: 'paid' }],
    ['unavailable', { issuer_kind: 'account' as const }],
    ['unavailable', { access_open_ended: null }],
  ])('%s', async (error, overrides) => {
    const w = world({ row: inviteRow(overrides) });
    expect(await complete(w.deps)).toMatchObject({ ok: false, kind: 'refused', status: 409, error });
    expect(w.calls).not.toContain('claim');
    expect(w.calls).not.toContain('create');
  });

  it('SA D-1: a LIVE claim answers signup_in_progress before any code check or account lookup', async () => {
    const w = world({ row: inviteRow({ claimed_at: at(-30_000), claimed_account_id: NEW_ID }) });
    expect(await complete(w.deps)).toMatchObject({ error: 'signup_in_progress' });
    expect(w.calls).toEqual(['find']);
  });

  it('an email that already has an account: existing_account, stamped once, audited, nothing claimed', async () => {
    const w = world({ emailHasAccount: true });
    expect(await complete(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
    expect(w.calls).toEqual(['find', `emailHasAccount:${EMAIL}`, 'stamp']);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT']);
  });

  it('a failed account lookup is "try again", never "no account"', async () => {
    const w = world({ emailHasAccountError: true });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('claim');
  });
});

describe('the code (T-5, D-5, AC-8)', () => {
  it('a wrong code is counted first, then refused with the attempts left; nothing is claimed or created', async () => {
    const w = world();
    expect(await complete(w.deps, { signupCode: '000000' })).toMatchObject({ error: 'code_invalid', attemptsRemaining: 4 });
    expect(w.calls).toEqual(['find', `emailHasAccount:${EMAIL}`, 'count']);
    expect(w.row()?.signup_code_attempts).toBe(1);
  });

  it('the fifth wrong code leaves 0 and audits the exhaustion; the sixth is code_locked without counting', async () => {
    const w = world({ row: inviteRow({ signup_code_attempts: 4 }) });
    expect(await complete(w.deps, { signupCode: '000000' })).toMatchObject({ error: 'code_invalid', attemptsRemaining: 0 });
    expect(w.audits).toEqual([
      { action: 'BOS_INVITE_REDEMPTION_REFUSED', inviteId: INVITE_ID, accountId: null, details: { reason: 'code_attempts_exhausted' } },
    ]);
    const locked = world({ row: inviteRow({ signup_code_attempts: 5 }) });
    expect(await complete(locked.deps)).toMatchObject({ error: 'code_locked' });
    expect(locked.calls).not.toContain('count');
  });

  it('an expired or missing code is code_expired', async () => {
    const w = world({ row: inviteRow({ signup_code_expires_at: NOW.toISOString() }) });
    expect(await complete(w.deps)).toMatchObject({ error: 'code_expired' });
    const none = world({ row: inviteRow({ signup_code_hash: null, signup_code_expires_at: null }) });
    expect(await complete(none.deps)).toMatchObject({ error: 'code_expired' });
  });

  it('a lost attempt CAS (parallel guesses) is try_again and compares nothing', async () => {
    const w = world({ lostCas: 'count' });
    expect(await complete(w.deps)).toMatchObject({ error: 'try_again' });
    expect(w.calls).not.toContain('claim');
  });
});

describe('AC-5: races', () => {
  it('two completes with one code: the second loses the claim and creates nothing', async () => {
    const w = world();
    const first = await complete(w.deps);
    expect(first.ok).toBe(true);
    // The second request read the row before the first claimed it.
    const w2 = world({ lostCas: 'claim' });
    expect(await complete(w2.deps)).toMatchObject({ error: 'try_again' });
    expect(w2.calls).not.toContain('create');
  });

  it('two invites to one email: the second createUser says email_exists, no user at ITS id → released, existing_account', async () => {
    const w = world({ create: 'email_exists', userExists: false });
    expect(await complete(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
    expect(w.released).toEqual([NEW_ID]);
    expect(w.calls).not.toContain('finalise');
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEMPTION_REFUSED']);
    expectNoSecrets(w);
  });
});

describe('I-3 / D-dev-3: an account id we did not ask for is never finalised', () => {
  it('keeps the claim, records create_user_id_mismatch with the RETURNED id, audits INCOMPLETE, answers try again', async () => {
    const w = world({ create: 'mismatch' });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('finalise');
    expect(w.calls).not.toContain('release');
    expect(w.recorded).toEqual([
      expect.objectContaining({
        id: INVITE_ID,
        claimedAccountId: NEW_ID,
        step: 'create_user_id_mismatch',
        failedAccountId: '99999999-9999-4999-8999-999999999999',
      }),
    ]);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEMPTION_INCOMPLETE']);
    expectNoSecrets(w);
  });
});

describe('I-4 / D-dev-2: release only on a positive "no such user"', () => {
  it('a failure with no user at our id → released, try again; nothing recorded', async () => {
    const w = world({ create: 'other', userExists: false });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.released).toEqual([NEW_ID]);
    expect(w.recorded).toEqual([]);
  });

  it('a failure (e.g. a timeout) that DID create our user → finalised, the signup completes', async () => {
    const w = world({ create: 'other', userExists: true });
    expect(await complete(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(w.calls).not.toContain('release');
  });

  it('never release on uncertainty: the user lookup failing keeps the claim and records find_user', async () => {
    const w = world({ create: 'other', userExists: 'error' });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('release');
    expect(w.recorded).toEqual([expect.objectContaining({ step: 'find_user', claimedAccountId: NEW_ID, failedAccountId: NEW_ID })]);
    // SA D-2: the auth message held the email; the stored one does not.
    expect(w.recorded[0].errorMessage).toBe('timeout creating [email]');
    expectNoSecrets(w);
  });

  it('a weak password is a clean refusal: released, 400', async () => {
    const w = world({ create: 'weak_password' });
    expect(await complete(w.deps)).toMatchObject({ status: 400, error: 'weak_password' });
    expect(w.released).toEqual([NEW_ID]);
  });
});

describe('I-5: finalise is retried once, then the claim is kept and recorded', () => {
  it('one failure then success: completes, finalise called twice', async () => {
    const w = world({ finaliseFailures: 1 });
    expect(await complete(w.deps)).toMatchObject({ ok: true });
    expect(w.calls.filter((call) => call === 'finalise')).toHaveLength(2);
  });

  it('two failures: claim kept, finalise record with the scrubbed error, INCOMPLETE audited with exactly the record fields', async () => {
    const w = world({ finaliseFailures: 2 });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('release');
    expect(w.recorded).toEqual([
      expect.objectContaining({ step: 'finalise', errorCode: '23505', errorMessage: 'insert failed for [email]', failedAccountId: NEW_ID }),
    ]);
    const incomplete = w.audits.find((entry) => entry.action === 'BOS_INVITE_REDEMPTION_INCOMPLETE');
    expect(incomplete).toEqual({
      action: 'BOS_INVITE_REDEMPTION_INCOMPLETE',
      inviteId: INVITE_ID,
      accountId: NEW_ID,
      details: {
        redemptionFailedAt: NOW.toISOString(),
        redemptionFailedStep: 'finalise',
        redemptionErrorCode: '23505',
        redemptionErrorMessage: 'insert failed for [email]',
        redemptionFailedAccountId: NEW_ID,
      },
    });
    expectNoSecrets(w);
  });

  it('finalise matching no row twice is also kept and recorded', async () => {
    const w = world({ finaliseReturnsNull: true });
    expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.recorded).toEqual([expect.objectContaining({ step: 'finalise', errorCode: null })]);
  });
});

describe('I-6: a lapsed claim is re-taken with the SAME id', () => {
  const lapsed = () =>
    inviteRow({
      claimed_at: at(-10 * 60_000),
      claimed_account_id: NEW_ID,
    });

  it('re-claims with the recorded id, not a new one, and compares the observed claimant (D-dev-1)', async () => {
    const w = world({ row: lapsed() });
    w.deps.newAccountId = () => 'should-not-be-used';
    expect(await complete(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(w.deps.invites.claimForSignup).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: NEW_ID, observedClaimedAccountId: NEW_ID })
    );
  });

  it('with a lapsed claim the account lookup is skipped, and email_exists + OUR user exists → finalise (race-only, SA D-6)', async () => {
    const w = world({ row: lapsed(), emailHasAccount: true, create: 'email_exists', userExists: true });
    expect(await complete(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(w.calls).not.toContain(`emailHasAccount:${EMAIL}`);
  });
});

describe('I-2: after the claim, expiry does not win', () => {
  it('the finalise call carries no expiry or revoke check of its own (the claim was the decision point)', async () => {
    const w = world();
    await complete(w.deps);
    expect(Object.keys(w.finalised[0]).sort()).toEqual(['accountId', 'cohort', 'email', 'inviteId']);
  });
});

describe('requestSignupCode (per-invite limit, system email)', () => {
  it('stores a fresh code by CAS and emails it to the invite address in the invite language', async () => {
    const w = world({ row: inviteRow({ signup_code_last_sent_at: at(-120_000), language: 'he' }) });
    const outcome = await requestSignupCode(TOKEN, w.deps);
    expect(outcome).toEqual({
      ok: true,
      codeExpiresAt: at(10 * 60_000),
      resendAvailableAt: at(60_000),
    });
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].to).toBe(EMAIL);
    expect(w.sent[0].language).toBe('he');
    expect(w.sent[0].code).toMatch(/^[0-9]{6}$/);
    expect(w.row()?.signup_code_hash).toBe(hashSignupCode(INVITE_ID, w.sent[0].code));
    expect(w.row()?.signup_code_attempts).toBe(0);
    expect(JSON.stringify(w.logs)).not.toContain(w.sent[0].code);
    expectNoSecrets(w);
  });

  it('within 60 s: 429 code_recently_sent, nothing stored or sent', async () => {
    const w = world({ row: inviteRow({ signup_code_last_sent_at: at(-10_000) }) });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ status: 429, error: 'code_recently_sent', retryAfterSeconds: 50 });
    expect(w.calls).not.toContain('issue');
    expect(w.calls).not.toContain('send');
  });

  it('five in the window: 429 code_limit_reached', async () => {
    const w = world({ row: inviteRow({ signup_code_sent_count: 5, signup_code_last_sent_at: at(-120_000) }) });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ status: 429, error: 'code_limit_reached' });
  });

  it('a send failure is 503 code_not_sent, and the send still counts', async () => {
    const w = world({ row: inviteRow({ signup_code_last_sent_at: at(-120_000) }), sendFails: true });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ status: 503, error: 'code_not_sent' });
    expect(w.row()?.signup_code_sent_count).toBe(2);
  });

  it('a lost CAS is try_again and sends nothing', async () => {
    const w = world({ row: inviteRow({ signup_code_last_sent_at: at(-120_000) }), lostCas: 'issue' });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ error: 'try_again' });
    expect(w.calls).not.toContain('send');
  });

  it('SA D-6: never skips the account lookup, even with a lapsed claim', async () => {
    const w = world({ row: inviteRow({ claimed_at: at(-600_000), claimed_account_id: NEW_ID }), emailHasAccount: true });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ error: 'existing_account' });
  });

  it('a live claim is signup_in_progress', async () => {
    const w = world({ row: inviteRow({ claimed_at: at(-5_000), claimed_account_id: NEW_ID }) });
    expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ error: 'signup_in_progress' });
  });

  it('SA MF-2: at a 24 h rollover (previous window sent exactly 1) parallel requests all compute count 1; only ONE wins', async () => {
    const w = world({
      row: inviteRow({
        signup_code_sent_count: 1,
        signup_code_window_started_at: at(-25 * 3600_000),
        signup_code_last_sent_at: at(-25 * 3600_000),
      }),
    });
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => requestSignupCode(TOKEN, w.deps)));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, kind: 'refused', status: 409, error: 'try_again' },
      { ok: false, kind: 'refused', status: 409, error: 'try_again' },
      { ok: false, kind: 'refused', status: 409, error: 'try_again' },
    ]);
    expect(w.sent).toHaveLength(1);
    expect(w.row()?.signup_code_sent_count).toBe(1);
  });

  it('SA MF-2: the issue CAS carries the observed last-sent time and the lease cutoff', async () => {
    const lastSent = at(-120_000);
    const w = world({ row: inviteRow({ signup_code_last_sent_at: lastSent }) });
    await requestSignupCode(TOKEN, w.deps);
    expect(w.deps.invites.issueSignupCode).toHaveBeenCalledWith(
      expect.objectContaining({ observedLastSentAt: lastSent, claimLeaseCutoff: new Date(NOW.getTime() - 120_000) })
    );
  });
});
