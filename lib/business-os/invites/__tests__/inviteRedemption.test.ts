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
 *
 * Slice 5b adds a champion's FRIEND (F5b-2, F5b-3, T-19): the explicit branch,
 * the existing-account check after mailbox proof (with the decoy code), the
 * friend finalise for both methods, and the landing on the payment hold.
 */

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInviteRedemptionView, FriendFinaliseOutcome } from '@/lib/repositories/types';

import { createGoogleIdTokenVerifier, type GoogleIdTokenVerification, type GoogleTokenClient } from '../googleIdToken';
import {
  completeGoogleSignup,
  completeSignup,
  requestSignupCode,
  type RedemptionAuditEntry,
  type RedemptionDeps,
} from '../inviteRedemption';
import { refusalToHttp } from '../redemptionDeps';
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
    issuer_account_id: null,
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
  /** Both system emails report the platform sender as unconfigured (fail closed). */
  senderNotConfigured?: boolean;
  lostCas?: 'count' | 'claim' | 'issue';
  /** Slice 3b: what the Google verifier answers (default: ok, for the invited address). */
  google?: GoogleIdTokenVerification;
  /** Slice 5b: the issuer's plan row (default: an in-force champion). */
  issuerPlan?: { cohort: string | null; cohort_expires_at: string | null } | null | 'error';
  /** Slice 5b: what successive friend finalise calls answer (default: finalised at L2). */
  friendFinalise?: Array<FriendFinaliseOutcome | 'error'>;
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
  const verified: Array<{ idToken: string; rawNonce: string }> = [];
  const notices: Array<{ to: string; language: string }> = [];
  const friendFinalised: Array<Record<string, unknown>> = [];
  const friendAnswers = [...(options.friendFinalise ?? [])];
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
      claimForGoogleSignup: jest.fn(async (input) => {
        calls.push('claimGoogle');
        if (options.lostCas === 'claim' || !row || row.claimed_account_id !== input.observedClaimedAccountId) {
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
      createConfirmedUserWithoutPassword: jest.fn(async (input) => {
        calls.push('createGoogle');
        created.push(input as unknown as Record<string, unknown>);
        switch (options.create ?? 'ok') {
          case 'ok':
            return { ok: true as const, id: input.id };
          case 'mismatch':
            return { ok: true as const, id: '99999999-9999-4999-8999-999999999999' };
          case 'email_exists':
            return { ok: false as const, kind: 'email_exists' as const, code: 'email_exists', message: `A user with this email address (${EMAIL}) has already been registered` };
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
    finaliseFriend: jest.fn(async (input) => {
      calls.push('finaliseFriend');
      friendFinalised.push(input as unknown as Record<string, unknown>);
      const answer = friendAnswers.length > 0 ? friendAnswers.shift() : undefined;
      if (answer === 'error') return { data: null, error: Object.assign(new Error(`insert failed for ${EMAIL}`), { code: '23505' }) };
      return { data: answer ?? { outcome: 'finalised' as const, inviteId: input.inviteId, level: 2 }, error: null };
    }),
    issuerPlans: {
      findEntitlementInputs: jest.fn(async (accountId: string) => {
        calls.push(`issuerPlan:${accountId}`);
        if (options.issuerPlan === 'error') return { data: null, error: new Error('plan read failed') };
        const plan =
          options.issuerPlan === undefined ? { cohort: INVITE_ISSUANCE_POLICY.account.issuerCohort, cohort_expires_at: null } : options.issuerPlan;
        return { data: { plan }, error: null };
      }),
    },
    sendCode: jest.fn(async (input) => {
      calls.push('send');
      sent.push(input);
      if (options.senderNotConfigured) return { sent: false, senderNotConfigured: true };
      return { sent: !options.sendFails };
    }),
    sendExistingAccountNotice: jest.fn(async (input) => {
      calls.push('notice');
      notices.push(input);
      if (options.senderNotConfigured) return { sent: false, senderNotConfigured: true };
      return { sent: !options.sendFails };
    }),
    audit: jest.fn(async (entry: RedemptionAuditEntry) => {
      audits.push(entry);
    }),
    config: getEntitlementConfig(),
    now: () => NOW,
    newAccountId: () => NEW_ID,
    verifyGoogleIdToken: jest.fn(async (input: { idToken: string; rawNonce: string }) => {
      calls.push('verifyGoogle');
      verified.push(input);
      return options.google ?? { kind: 'ok' as const, email: EMAIL };
    }),
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
    verified,
    notices,
    friendFinalised,
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

    expect(outcome).toEqual({ ok: true, email: EMAIL, accountId: NEW_ID, inviteId: INVITE_ID, landing: 'onboarding' });
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
    expect(Object.keys(w.deps.accounts).sort()).toEqual([
      'createConfirmedUser',
      'createConfirmedUserWithoutPassword',
      'emailHasAccount',
      'findUserExists',
    ]);
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

// ════════════════════════════════════════════════════════════════════════════
// Slice 3b: completeGoogleSignup (T-3b-2 to T-3b-11, SA R-1, R-2, R-10, Q-4)
// ════════════════════════════════════════════════════════════════════════════

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMTAxNjkifQ.c2lnbmF0dXJl';
const RAW_NONCE = 'r'.repeat(43);
const GOOGLE_SUB = '110169484474386276334';

const google = (deps: RedemptionDeps, overrides: Partial<{ token: string; idToken: string; nonce: string }> = {}) =>
  completeGoogleSignup({ token: TOKEN, idToken: ID_TOKEN, nonce: RAW_NONCE, ...overrides }, deps);

/** Nothing from the invite or from Google in the audit, the failure records or the logs (AC-9, R-1, R-11). */
function expectNoGoogleSecrets(w: ReturnType<typeof world>, ...extra: string[]) {
  expectNoSecrets(w);
  const text = JSON.stringify({ audits: w.audits, recorded: w.recorded, logs: w.logs });
  for (const secret of [ID_TOKEN, RAW_NONCE, GOOGLE_SUB, ...extra]) expect(text).not.toContain(secret);
}

describe('Slice 3b: the Google happy path (T-3b-2)', () => {
  it('load → verify → Google claim for a server-made id → password-less create → finalise → REDEEMED (method google)', async () => {
    const w = world();
    const outcome = await google(w.deps);

    expect(outcome).toEqual({ ok: true, accountId: NEW_ID, inviteId: INVITE_ID, landing: 'onboarding' });
    expect(w.calls).toEqual(['find', `emailHasAccount:${EMAIL}`, 'verifyGoogle', 'claimGoogle', 'createGoogle', 'finalise']);
    // The verifier gets exactly what the page sent; nothing else from the request reaches anything.
    expect(w.verified).toEqual([{ idToken: ID_TOKEN, rawNonce: RAW_NONCE }]);
    // §3.4 allow-list: the server's id and the ROW's email. No password, no metadata.
    expect(w.created).toEqual([{ id: NEW_ID, email: EMAIL }]);
    expect(w.deps.invites.claimForGoogleSignup).toHaveBeenCalledWith({
      id: INVITE_ID,
      accountId: NEW_ID,
      observedClaimedAccountId: null,
      now: NOW,
      claimLeaseCutoff: new Date(NOW.getTime() - 120_000),
    });
    expect(w.finalised).toEqual([{ inviteId: INVITE_ID, accountId: NEW_ID, email: EMAIL, cohort: 'champion' }]);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEEMED', 'BOS_INVITE_PLAN_PROVISIONED']);
    expect(w.audits[0].details).toEqual({ inviteType: 'champion', level: 1, source: 'admin_invite', method: 'google' });
    // The code path's claim and creator are never used.
    expect(w.calls).not.toContain('claim');
    expect(w.calls).not.toContain('create');
    expectNoGoogleSecrets(w);
  });

  it('the success outcome carries no email (the browser signs in with the Google token)', async () => {
    const outcome = await google(world().deps);
    expect(JSON.stringify(outcome)).not.toContain(EMAIL);
  });

  it('T-3b-3: the code path now records method: password on REDEEMED', async () => {
    const w = world();
    await complete(w.deps);
    expect(w.audits[0]).toMatchObject({ action: 'BOS_INVITE_REDEEMED', details: { method: 'password' } });
  });

  it('T-3b-5: the match is case-insensitive on both sides', async () => {
    // The verifier returns the Google address lower-cased; a mixed-case invite email (should one exist) still matches.
    const mixed = world({ row: inviteRow({ email: 'Invitee@Example.com' }) });
    expect(await google(mixed.deps)).toMatchObject({ ok: true });
    // The account is created for the ROW's address, byte for byte, never the token's.
    expect(mixed.created).toEqual([{ id: NEW_ID, email: 'Invitee@Example.com' }]);
  });
});

describe('Slice 3b: refusals before any claim', () => {
  it.each([
    ['a different address', 'someone.else@example.com'],
    ['a +tag the invite does not have (D-7, no folding)', 'invitee+tag@example.com'],
    ['a dot variant (no folding)', 'in.vitee@example.com'],
  ])('T-3b-4: %s → 409 google_email_mismatch, no claim, no user, audited with no address', async (_label, googleEmail) => {
    const w = world({ google: { kind: 'ok', email: googleEmail } });
    const outcome = await google(w.deps);
    expect(outcome).toEqual({ ok: false, kind: 'refused', status: 409, error: 'google_email_mismatch' });
    expect(w.calls).not.toContain('claimGoogle');
    expect(w.calls).not.toContain('createGoogle');
    expect(w.audits).toEqual([
      { action: 'BOS_INVITE_REDEMPTION_REFUSED', inviteId: INVITE_ID, accountId: null, details: { reason: 'google_email_mismatch', method: 'google' } },
    ]);
    expectNoGoogleSecrets(w, googleEmail);
    const body = JSON.stringify(refusalToHttp(outcome as Extract<typeof outcome, { ok: false }>));
    expect(body).not.toContain(EMAIL);
    expect(body).not.toContain(googleEmail);
  });

  it('an invite to x+tag@gmail.com cannot be redeemed by x@gmail.com (the documented D-7 consequence)', async () => {
    const w = world({ row: inviteRow({ email: 'x+tag@gmail.com' }), google: { kind: 'ok', email: 'x@gmail.com' } });
    expect(await google(w.deps)).toMatchObject({ error: 'google_email_mismatch' });
  });

  it('T-3b-6: unverified → 409 google_email_unverified, audited, no claim', async () => {
    const w = world({ google: { kind: 'unverified' } });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'refused', status: 409, error: 'google_email_unverified' });
    expect(w.calls).not.toContain('claimGoogle');
    expect(w.audits).toEqual([
      { action: 'BOS_INVITE_REDEMPTION_REFUSED', inviteId: INVITE_ID, accountId: null, details: { reason: 'google_email_unverified', method: 'google' } },
    ]);
    expectNoGoogleSecrets(w);
  });

  it('SA R-2: not authoritative → 409 google_use_code, audited google_account_not_authoritative, no claim, no user', async () => {
    const w = world({ google: { kind: 'not_authoritative' } });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'refused', status: 409, error: 'google_use_code' });
    expect(w.calls).not.toContain('claimGoogle');
    expect(w.calls).not.toContain('createGoogle');
    expect(w.audits).toEqual([
      {
        action: 'BOS_INVITE_REDEMPTION_REFUSED',
        inviteId: INVITE_ID,
        accountId: null,
        details: { reason: 'google_account_not_authoritative', method: 'google' },
      },
    ]);
    expectNoGoogleSecrets(w);
  });

  it('an invalid token → 400 google_token_invalid, logged with its reason code only, not audited', async () => {
    const w = world({ google: { kind: 'invalid', reason: 'nonce' } });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'refused', status: 400, error: 'google_token_invalid' });
    expect(w.audits).toEqual([]);
    expect(w.calls).not.toContain('claimGoogle');
    expect(JSON.stringify(w.logs)).toContain('"googleTokenRefusal":"nonce"');
  });

  it('R-5: Google unavailable → 503 try again, no claim', async () => {
    const w = world({ google: { kind: 'unavailable' } });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('claimGoogle');
  });

  it('not configured → 404 google_signin_not_configured', async () => {
    const w = world({ google: { kind: 'not_configured' } });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'refused', status: 404, error: 'google_signin_not_configured' });
  });

  it('T-3b-7: an existing account → 409 existing_account, stamped and audited once, with no token verification', async () => {
    const w = world({ emailHasAccount: true });
    expect(await google(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
    expect(w.calls).toEqual(['find', `emailHasAccount:${EMAIL}`, 'stamp']);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT']);
  });

  it('T-3b-8: a live claim → 409 signup_in_progress before verification', async () => {
    const w = world({ row: inviteRow({ claimed_at: at(-30_000), claimed_account_id: NEW_ID }) });
    expect(await google(w.deps)).toMatchObject({ error: 'signup_in_progress' });
    expect(w.calls).toEqual(['find']);
  });

  it('T-3b-10: a paid (tier) invite → 409 paid_invites_not_available, before verification', async () => {
    const w = world({ row: inviteRow({ grant_kind: 'tier', grant_id: 'tier-x', access_open_ended: null }) });
    expect(await google(w.deps)).toMatchObject({ status: 409, error: 'paid_invites_not_available' });
    expect(w.calls).not.toContain('verifyGoogle');
  });

  it.each([
    ['used', { redeemed_at: at(-1000) }],
    ['revoked', { revoked_at: at(-1000) }],
    ['expired', { link_expires_at: NOW.toISOString() }],
    ['unavailable', { issuer_kind: 'account' as const }],
  ])('%s, before verification', async (error, overrides) => {
    const w = world({ row: inviteRow(overrides) });
    expect(await google(w.deps)).toMatchObject({ status: 409, error });
    expect(w.calls).not.toContain('verifyGoogle');
  });

  it('a malformed or unknown token is not_recognised, with no verification', async () => {
    const w = world();
    expect(await google(w.deps, { token: 'abc' })).toEqual({ ok: false, kind: 'not_recognised' });
    expect(await google(w.deps, { token: generateInviteToken() })).toEqual({ ok: false, kind: 'not_recognised' });
    expect(w.calls).not.toContain('verifyGoogle');
  });
});

describe('Slice 3b: SA Q-4 / T-3b-11, the code limits do not apply to Google', () => {
  it('an invite locked after 5 wrong codes is still redeemed with Google; the counters are untouched', async () => {
    const w = world({ row: inviteRow({ signup_code_attempts: 5 }) });
    expect(await complete(w.deps)).toMatchObject({ error: 'code_locked' });

    const g = world({ row: inviteRow({ signup_code_attempts: 5 }) });
    expect(await google(g.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(g.calls).not.toContain('count');
    expect(g.calls).not.toContain('issue');
  });

  it('the outstanding code hash and its expiry are cleared by the Google claim', async () => {
    const w = world();
    expect(w.row()?.signup_code_hash).not.toBeNull();
    await google(w.deps);
    expect(w.row()?.signup_code_hash).toBeNull();
    expect(w.row()?.signup_code_expires_at).toBeNull();
  });

  it('an invite with no code ever requested is redeemed with Google', async () => {
    const w = world({ row: inviteRow({ signup_code_hash: null, signup_code_expires_at: null, signup_code_sent_count: 0 }) });
    expect(await google(w.deps)).toMatchObject({ ok: true });
  });
});

describe('Slice 3b: the shared tail after the Google claim (T-3b-9)', () => {
  it('a lost claim CAS → 409 try_again, no user', async () => {
    const w = world({ lostCas: 'claim' });
    expect(await google(w.deps)).toMatchObject({ status: 409, error: 'try_again' });
    expect(w.calls).not.toContain('createGoogle');
  });

  it('email_exists and OUR id exists → finished', async () => {
    const w = world({ create: 'email_exists', userExists: true });
    expect(await google(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(w.calls).not.toContain('release');
  });

  it('email_exists and not ours → released, 409 existing_account, audited, nothing Google-derived', async () => {
    const w = world({ create: 'email_exists', userExists: false });
    expect(await google(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
    expect(w.released).toEqual([NEW_ID]);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEMPTION_REFUSED']);
    expectNoGoogleSecrets(w);
  });

  it('an uncertain user lookup keeps the claim and records find_user (scrubbed), 503', async () => {
    const w = world({ create: 'other', userExists: 'error' });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('release');
    expect(w.recorded).toEqual([expect.objectContaining({ step: 'find_user', claimedAccountId: NEW_ID })]);
    expect(w.recorded[0].errorMessage).toBe('timeout creating [email]');
    expectNoGoogleSecrets(w);
  });

  it('finalise failing twice keeps the claim and records finalise, 503', async () => {
    const w = world({ finaliseFailures: 2 });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.recorded).toEqual([expect.objectContaining({ step: 'finalise' })]);
    expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEMPTION_INCOMPLETE']);
  });

  it('an id we did not ask for is never finalised: create_user_id_mismatch', async () => {
    const w = world({ create: 'mismatch' });
    expect(await google(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
    expect(w.calls).not.toContain('finalise');
    expect(w.recorded).toEqual([expect.objectContaining({ step: 'create_user_id_mismatch' })]);
  });
});

describe('Slice 3b: I-6 across methods (T-3b-8, SA R-10)', () => {
  const lapsed = () =>
    inviteRow({ claimed_at: at(-10 * 60_000), claimed_account_id: NEW_ID, signup_code_hash: null, signup_code_expires_at: null });

  it('a lapsed claim is re-taken by Google with the recorded id, comparing the observed claimant', async () => {
    const w = world({ row: lapsed() });
    w.deps.newAccountId = () => 'should-not-be-used';
    expect(await google(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    expect(w.deps.invites.claimForGoogleSignup).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: NEW_ID, observedClaimedAccountId: NEW_ID })
    );
  });

  it('R-10: a lapsed PASSWORD-path claim whose account exists is finished by Google (email_exists → ours → finalise), method google', async () => {
    const w = world({ row: lapsed(), emailHasAccount: true, create: 'email_exists', userExists: true });
    expect(await google(w.deps)).toMatchObject({ ok: true, accountId: NEW_ID });
    // The account lookup is skipped with a lapsed claim (I-6), as on the code path.
    expect(w.calls).not.toContain(`emailHasAccount:${EMAIL}`);
    expect(w.calls).toEqual(['find', 'verifyGoogle', 'claimGoogle', 'createGoogle', 'findUser', 'finalise']);
    expect(w.audits[0]).toMatchObject({ action: 'BOS_INVITE_REDEEMED', details: { method: 'google' } });
  });
});

describe('Slice 3b, SA R-1: a payload-bearing library error reaches no log, audit or response', () => {
  const LEAKED_EMAIL = 'leak.victim@gmail.com';

  it('with the REAL verifier over a client whose error message holds the payload', async () => {
    const leakingPayload = JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'client',
      sub: GOOGLE_SUB,
      email: LEAKED_EMAIL,
      email_verified: true,
      name: 'Leak Victim',
    });
    const client: GoogleTokenClient = {
      getFederatedSignonCertsAsync: async () => ({}),
      verifyIdToken: async () => {
        throw new Error(`Token used too late, 1790000000 > 1789999000: ${leakingPayload}`);
      },
    };
    const w = world({ row: inviteRow({ email: LEAKED_EMAIL }) });
    w.deps.verifyGoogleIdToken = createGoogleIdTokenVerifier({ client, clientId: () => 'client', now: () => NOW });

    const outcome = await google(w.deps);
    expect(outcome).toEqual({ ok: false, kind: 'refused', status: 400, error: 'google_token_invalid' });

    const response = refusalToHttp(outcome as Extract<typeof outcome, { ok: false }>);
    const everything = JSON.stringify({ logs: w.logs, audits: w.audits, recorded: w.recorded, response });
    expect(everything).not.toContain(LEAKED_EMAIL);
    expect(everything).not.toContain(GOOGLE_SUB);
    expect(everything).not.toContain('Leak Victim');
    expect(everything).not.toContain('Token used too late');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Slice 5b: a champion's FRIEND signs up (F5b-2, F5b-3, T-19, FR-34, FR-35)
// ─────────────────────────────────────────────────────────────────────────────

const CHAMPION_ID = '44444444-4444-4444-8444-444444444444';
const switchable = INVITE_ISSUANCE_POLICY as unknown as { accountInvitesAvailable: boolean };
// Restore the value the config shipped with, not a hardcoded one: the switch
// has been on in production since Slice 5b, and a hook that forced `false`
// leaked a state the real config no longer has into every later test.
const shippedSwitch = INVITE_ISSUANCE_POLICY.accountInvitesAvailable;

/** A friend invite exactly as the 5a send writes it. */
const friendInvite = (overrides: Partial<BusinessOsInviteRedemptionView> = {}) =>
  inviteRow({
    issuer_kind: 'account',
    issuer_account_id: CHAMPION_ID,
    invite_type: INVITE_ISSUANCE_POLICY.account.inviteType,
    grant_kind: 'tier',
    grant_id: INVITE_ISSUANCE_POLICY.account.grantId,
    access_open_ended: null,
    ...overrides,
  });

describe('Slice 5b: switch OFF (the rollback state): a friend invite is refused before any side effect (T-18)', () => {
  // The switch ships ON since 2026-10-01 (pinned in inviteConfig.invariant.test.ts),
  // so this block turns it off itself and restores the shipped value after.
  const shipped = INVITE_ISSUANCE_POLICY.accountInvitesAvailable;
  beforeEach(() => {
    switchable.accountInvitesAvailable = false;
  });
  afterEach(() => {
    switchable.accountInvitesAvailable = shipped;
  });

  it('the switch is off in this block', () => {
    expect(INVITE_ISSUANCE_POLICY.accountInvitesAvailable).toBe(false);
  });

  it.each([
    ['requestSignupCode', (deps: RedemptionDeps) => requestSignupCode(TOKEN, deps)],
    ['completeSignup', (deps: RedemptionDeps) => complete(deps)],
    ['completeGoogleSignup', (deps: RedemptionDeps) => google(deps)],
  ])('%s answers "no longer available" with only the token lookup run', async (_entry, run) => {
    const w = world({ row: friendInvite(), emailHasAccount: true });
    expect(await run(w.deps)).toMatchObject({ ok: false, status: 409, error: 'unavailable' });
    expect(w.calls).toEqual(['find']);
    expect(w.sent).toEqual([]);
    expect(w.notices).toEqual([]);
    expect(w.created).toEqual([]);
  });

  it('an ADMIN Paid invite is still paid_invites_not_available (F5b-2: the generic refusal stays until 5c)', async () => {
    const w = world({ row: inviteRow({ invite_type: 'paid', grant_kind: 'tier', grant_id: 'tier-x', access_open_ended: null }) });
    expect(await complete(w.deps)).toMatchObject({ status: 409, error: 'paid_invites_not_available' });
    expect(w.calls).toEqual(['find']);
  });
});

describe('Slice 5b: switch ON', () => {
  beforeEach(() => {
    switchable.accountInvitesAvailable = true;
  });
  afterEach(() => {
    switchable.accountInvitesAvailable = shippedSwitch;
  });

  describe('the friend branch refuses before any code, email, claim or account (F5b-2)', () => {
    it.each([
      ['a wrong type', { invite_type: 'champion' }],
      ['a wrong tier', { grant_id: 'another-tier' }],
      ['a cohort grant', { grant_kind: 'cohort' as const, grant_id: 'champion' }],
      ['no issuer id', { issuer_account_id: null }],
    ])('%s → unavailable', async (_label, overrides) => {
      const w = world({ row: friendInvite(overrides) });
      expect(await requestSignupCode(TOKEN, w.deps)).toMatchObject({ status: 409, error: 'unavailable' });
      expect(w.calls.filter((call) => !call.startsWith('find'))).toEqual([]);
    });

    it.each([
      ['not a champion', { cohort: 'trial', cohort_expires_at: null }],
      ['a lapsed champion', { cohort: INVITE_ISSUANCE_POLICY.account.issuerCohort, cohort_expires_at: at(-1000) }],
      ['no plan row', null],
    ])('the issuer is %s → unavailable (AC-18: nothing written)', async (_label, plan) => {
      const w = world({ row: friendInvite(), issuerPlan: plan });
      expect(await complete(w.deps)).toMatchObject({ status: 409, error: 'unavailable' });
      expect(w.calls).toEqual(['find', `issuerPlan:${CHAMPION_ID}`]);
    });

    it('the issuer read failing is "try again", never a pass', async () => {
      const w = world({ row: friendInvite(), issuerPlan: 'error' });
      expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
      expect(w.calls).not.toContain('claim');
    });
  });

  describe('the password path', () => {
    it('happy path: the friend finalise with the config tier and cohort, and the landing is the payment hold', async () => {
      const w = world({ row: friendInvite() });
      const outcome = await complete(w.deps);

      expect(outcome).toEqual({ ok: true, email: EMAIL, accountId: NEW_ID, inviteId: INVITE_ID, landing: 'awaiting_payment' });
      expect(w.calls).toEqual([
        'find',
        `issuerPlan:${CHAMPION_ID}`,
        'count',
        // F5b-3: the account question is asked only AFTER the code matched.
        `emailHasAccount:${EMAIL}`,
        'claim',
        'create',
        'finaliseFriend',
      ]);
      expect(w.friendFinalised).toEqual([
        {
          inviteId: INVITE_ID,
          accountId: NEW_ID,
          email: EMAIL,
          tierId: INVITE_ISSUANCE_POLICY.account.grantId,
          issuerCohort: INVITE_ISSUANCE_POLICY.account.issuerCohort,
        },
      ]);
      expect(w.finalised).toEqual([]);
      expect(w.audits).toEqual([
        {
          action: 'BOS_INVITE_REDEEMED',
          inviteId: INVITE_ID,
          accountId: NEW_ID,
          details: { inviteType: INVITE_ISSUANCE_POLICY.account.inviteType, level: 2, source: 'account_invite', method: 'password' },
        },
        {
          action: 'BOS_INVITE_PLAN_PROVISIONED',
          inviteId: INVITE_ID,
          accountId: NEW_ID,
          details: {
            grantKind: 'tier',
            grantId: INVITE_ISSUANCE_POLICY.account.grantId,
            basis: 'none',
            awaitingPayment: true,
            origin: 'invite',
          },
        },
      ]);
      expectNoSecrets(w);
    });

    it('audits the level the function wrote (L3 under an L2 champion)', async () => {
      const w = world({ row: friendInvite(), friendFinalise: [{ outcome: 'finalised', inviteId: INVITE_ID, level: 3 }] });
      await complete(w.deps);
      expect(w.audits[0].details.level).toBe(3);
    });

    it('F5b-3: an existing account with a WRONG code answers code_invalid, exactly like a new address', async () => {
      const withAccount = world({ row: friendInvite(), emailHasAccount: true });
      const withoutAccount = world({ row: friendInvite(), emailHasAccount: false });
      const a = await complete(withAccount.deps, { signupCode: '000000' });
      const b = await complete(withoutAccount.deps, { signupCode: '000000' });
      expect(a).toEqual(b);
      expect(a).toMatchObject({ error: 'code_invalid' });
      expect(withAccount.calls).not.toContain(`emailHasAccount:${EMAIL}`);
    });

    it('F5b-3: an existing account with the RIGHT code (mailbox proven): existing_account before any claim, stamped once', async () => {
      const w = world({ row: friendInvite(), emailHasAccount: true });
      expect(await complete(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
      expect(w.calls).toEqual(['find', `issuerPlan:${CHAMPION_ID}`, 'count', `emailHasAccount:${EMAIL}`, 'stamp']);
      expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT']);
    });

    it('I-6 keeps its meaning: with a lapsed claim the post-proof account question is skipped, and the same id is reused', async () => {
      const w = world({ row: friendInvite({ claimed_at: at(-10 * 60_000), claimed_account_id: NEW_ID }), create: 'email_exists', userExists: true });
      expect(await complete(w.deps)).toMatchObject({ ok: true, landing: 'awaiting_payment' });
      expect(w.calls).not.toContain(`emailHasAccount:${EMAIL}`);
      expect(w.friendFinalised[0].accountId).toBe(NEW_ID);
    });
  });

  describe('the finish (T-19, SA Q-1)', () => {
    it('already_finalised is a success (re-run safe)', async () => {
      const w = world({ row: friendInvite(), friendFinalise: [{ outcome: 'already_finalised', inviteId: INVITE_ID, level: 2 }] });
      expect(await complete(w.deps)).toMatchObject({ ok: true, landing: 'awaiting_payment' });
    });

    it('issuer_not_eligible: NO retry, the claim is kept, and FR-12a names the cause', async () => {
      const w = world({ row: friendInvite(), friendFinalise: [{ outcome: 'issuer_not_eligible' }] });
      expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
      expect(w.calls.filter((call) => call === 'finaliseFriend')).toHaveLength(1);
      expect(w.released).toEqual([]);
      expect(w.recorded).toEqual([
        expect.objectContaining({ step: 'finalise', errorCode: 'issuer_not_eligible', failedAccountId: NEW_ID }),
      ]);
      expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_REDEMPTION_INCOMPLETE']);
      expectNoSecrets(w);
    });

    it('not_matched then success: retried once (I-5)', async () => {
      const w = world({ row: friendInvite(), friendFinalise: [{ outcome: 'not_matched' }] });
      expect(await complete(w.deps)).toMatchObject({ ok: true });
      expect(w.calls.filter((call) => call === 'finaliseFriend')).toHaveLength(2);
    });

    it('two errors: the claim is kept and recorded, and the scrubbed message has no email (AC-5a)', async () => {
      const w = world({ row: friendInvite(), friendFinalise: ['error', 'error'] });
      expect(await complete(w.deps)).toEqual({ ok: false, kind: 'unavailable_try_again' });
      expect(w.recorded).toEqual([expect.objectContaining({ step: 'finalise', errorCode: '23505' })]);
      expect(w.released).toEqual([]);
      expectNoSecrets(w);
    });
  });

  describe('the code route: the decoy code (F5b-3, D-3)', () => {
    const request = async (hasAccount: boolean, extra: WorldOptions = {}) => {
      const w = world({ row: friendInvite({ signup_code_last_sent_at: at(-10 * 60_000) }), emailHasAccount: hasAccount, ...extra });
      return { w, outcome: await requestSignupCode(TOKEN, w.deps) };
    };

    it('the HTTP answer is identical whether or not the address has an account', async () => {
      const a = await request(true);
      const b = await request(false);
      expect(a.outcome).toEqual(b.outcome);
      expect(a.outcome).toMatchObject({ ok: true });
    });

    it('a new address: a code is stored, then the account question, then the CODE email', async () => {
      const { w } = await request(false);
      expect(w.calls).toEqual(['find', `issuerPlan:${CHAMPION_ID}`, 'issue', `emailHasAccount:${EMAIL}`, 'send']);
      expect(w.sent).toHaveLength(1);
      expect(w.notices).toEqual([]);
    });

    it('an existing account: a code is STILL stored (the decoy), and the NOTICE goes instead of the code', async () => {
      const { w } = await request(true);
      expect(w.calls.slice(0, 4)).toEqual(['find', `issuerPlan:${CHAMPION_ID}`, 'issue', `emailHasAccount:${EMAIL}`]);
      expect(w.calls).toContain('notice');
      expect(w.calls).toContain('stamp');
      expect(w.calls).not.toContain('send');
      expect(w.sent).toEqual([]);
      expect(w.notices).toEqual([{ to: EMAIL, language: 'en' }]);
      // The stored code is live, so a later `complete` answers code_invalid, not code_expired.
      expect(w.row()?.signup_code_hash).not.toBeNull();
      expect(w.audits.map((entry) => entry.action)).toEqual(['BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT']);
    });

    it('both branches log the same line (the log must not tell them apart)', async () => {
      const a = await request(true);
      const b = await request(false);
      expect(JSON.stringify(a.w.logs)).toBe(JSON.stringify(b.w.logs));
    });

    it('QA-1: a notice that fails to send still answers EXACTLY like a new address that got its code', async () => {
      const existing = await request(true, { sendFails: true });
      const fresh = await request(false);
      expect(existing.outcome).toEqual(fresh.outcome);
      expect(existing.outcome).toMatchObject({ ok: true });
      // Logged at warn, by invite id only: never the address.
      expect(JSON.stringify(existing.w.logs)).toContain('Existing-account notice was not sent');
      expect(JSON.stringify(existing.w.logs)).not.toContain(EMAIL);
    });

    it("a new address's own code email failing stays 503 code_not_sent (it is about that address)", async () => {
      const { outcome } = await request(false, { sendFails: true });
      expect(outcome).toMatchObject({ status: 503, error: 'code_not_sent' });
    });

    it('an unconfigured platform sender answers EXACTLY the same for both (503 code_not_sent, same log)', async () => {
      const existing = await request(true, { senderNotConfigured: true });
      const fresh = await request(false, { senderNotConfigured: true });
      expect(fresh.outcome).toMatchObject({ status: 503, error: 'code_not_sent' });
      expect(existing.outcome).toEqual(fresh.outcome);
      expect(JSON.stringify(existing.w.logs)).toBe(JSON.stringify(fresh.w.logs));
      expect(JSON.stringify(existing.w.logs)).not.toContain(EMAIL);
    });

    it('a failed account lookup is "try again" for both (never "no account")', async () => {
      const { outcome } = await request(true, { emailHasAccountError: true });
      expect(outcome).toEqual({ ok: false, kind: 'unavailable_try_again' });
    });
  });

  describe('the Google path', () => {
    it('happy path: the friend finalise, method google, the payment hold', async () => {
      const w = world({ row: friendInvite() });
      expect(await google(w.deps)).toEqual({ ok: true, accountId: NEW_ID, inviteId: INVITE_ID, landing: 'awaiting_payment' });
      expect(w.calls).toEqual([
        'find',
        `issuerPlan:${CHAMPION_ID}`,
        'verifyGoogle',
        `emailHasAccount:${EMAIL}`,
        'claimGoogle',
        'createGoogle',
        'finaliseFriend',
      ]);
      expect(w.audits[0].details).toEqual({ inviteType: INVITE_ISSUANCE_POLICY.account.inviteType, level: 2, source: 'account_invite', method: 'google' });
    });

    it('F5b-3: the account question comes only AFTER the proof; an existing account then gets existing_account, nothing claimed', async () => {
      const w = world({ row: friendInvite(), emailHasAccount: true });
      expect(await google(w.deps)).toMatchObject({ status: 409, error: 'existing_account' });
      expect(w.calls.indexOf('verifyGoogle')).toBeLessThan(w.calls.indexOf(`emailHasAccount:${EMAIL}`));
      expect(w.calls).not.toContain('claimGoogle');
    });

    it('a refused proof never reaches the account question', async () => {
      const w = world({ row: friendInvite(), emailHasAccount: true, google: { kind: 'invalid', reason: 'nonce' } });
      expect(await google(w.deps)).toMatchObject({ status: 400, error: 'google_token_invalid' });
      expect(w.calls).not.toContain(`emailHasAccount:${EMAIL}`);
    });
  });
});
