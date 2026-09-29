import 'server-only';

/**
 * A champion signs up from an invite (invite-only signup, Slice 1b).
 *
 * Two operations, both reached only by the public signup routes:
 *
 *   requestSignupCode   token → a 6-digit code emailed to the invited address
 *   completeSignup      token + code + password → the account, the plan row,
 *                       the lineage row and the burned invite
 *
 * ── The one rule that shapes everything: claim before create (SA R-1) ──────
 * The invite is CLAIMED in the database, for an account id this server
 * generates, BEFORE the auth user exists. The user is then created with that
 * exact id, and a single SQL function finalises. So:
 *
 *   I-1  nothing is ever deleted: a signup that stops halfway keeps its claim
 *        and is finished by recovery (FR-12a), never undone;
 *   I-2  once claimed, a revoke or an expiry cannot win (the claim was the
 *        decision point; the revoke CAS refuses a live claim);
 *   I-3  the account id comes from here, is recorded on the invite first, and
 *        is never read from the request; a different returned id is never
 *        finalised;
 *   I-4  a failed account creation releases the claim ONLY after a positive
 *        "no such user" (never release on uncertainty, D-dev-2);
 *   I-5  finalise is one idempotent SQL function, retried once; a second
 *        failure keeps the claim and records the failure (D-2);
 *   I-6  a claim older than the lease may be re-taken, reusing its account id.
 *
 * ── Tenant isolation (`tenant-isolation-guard`) ─────────────────────────────
 * Service role, caller-supplied token. The ownership oracle is the token hash
 * plus the email lock; every write is keyed on the matched row's id and a
 * value observed on it (compare-and-swap). The request supplies ONLY the token,
 * the code and the password (the route's `.strict()` schema): the email, the
 * grant, the account id and the level all come from the row or from here.
 *
 * ── What is never written anywhere ──────────────────────────────────────────
 * The token, its hash, the code, the password. The email is used to create the
 * account and is returned to the browser only after a successful signup (F-6);
 * it is never logged, never audited, never stored in the failure record.
 *
 * Pure orchestration over injected dependencies, so every branch is testable.
 */

import {
  CHAMPION_INVITE_TYPE,
  INVITE_ISSUANCE_POLICY,
  type InviteTypeId,
} from '@/lib/business-os/entitlements/config/invites';
import { isRedeemableCohortGrant } from '@/lib/business-os/entitlements/grantRules';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { defaultLocale, isValidLocale } from '@/lib/i18n/config';
import type { AuthAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { AgentRepositoryResult as RepositoryResult, BusinessOsInviteRedemptionView } from '@/lib/repositories/types';

import { isInviteGrantAvailable } from './inviteOffer';
import { deriveInviteState } from './inviteState';
import { hashInviteToken, isWellFormedInviteToken } from './inviteToken';
import {
  decideCodeAttempt,
  decideCodeIssue,
  generateSignupCode,
  hashSignupCode,
  scrubFailureMessage,
  signupCodeMatches,
} from './signupCode';
import { claimLeaseCutoff, isClaimLive, type RedemptionFailureStep } from './signupCodePolicy';

// ── Dependencies ────────────────────────────────────────────────────────────

export type RedemptionInviteRepository = Pick<
  BusinessOsInviteRepository,
  | 'findByTokenHashForRedemption'
  | 'issueSignupCode'
  | 'countSignupCodeAttempt'
  | 'claimForSignup'
  | 'releaseSignupClaim'
  | 'recordRedemptionFailure'
  | 'markOpenedByExistingAccount'
>;

export type RedemptionAccounts = Pick<AuthAccountRepository, 'emailHasAccount' | 'createConfirmedUser' | 'findUserExists'>;

/** The finalise call (the plan repository's `provisionFromInvite`, bound by the route). */
export type FinaliseRedemption = (input: {
  inviteId: string;
  accountId: string;
  email: string;
  cohort: string;
}) => Promise<RepositoryResult<string>>;

/** One audit entry the route writes (non-blocking) and flushes before it answers. */
export interface RedemptionAuditEntry {
  action:
    | 'BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT'
    | 'BOS_INVITE_REDEEMED'
    | 'BOS_INVITE_PLAN_PROVISIONED'
    | 'BOS_INVITE_REDEMPTION_REFUSED'
    | 'BOS_INVITE_REDEMPTION_INCOMPLETE';
  inviteId: string;
  /** The new account, when there is one. `null` for an anonymous event. */
  accountId: string | null;
  details: Record<string, string | number | boolean | null>;
}

export interface RedemptionLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface RedemptionDeps {
  invites: RedemptionInviteRepository;
  accounts: RedemptionAccounts;
  finalise: FinaliseRedemption;
  /** Sends the code email; never throws. The code is in the body only. */
  sendCode: (input: { to: string; code: string; language: string }) => Promise<{ sent: boolean }>;
  audit: (entry: RedemptionAuditEntry) => Promise<void>;
  config: EntitlementConfig;
  now: () => Date;
  /** The server-side account id generator (I-3). `crypto.randomUUID` in production. */
  newAccountId: () => string;
  logger: RedemptionLogger;
}

// ── Outcomes ────────────────────────────────────────────────────────────────

/** A refusal the route turns into a status and a machine-readable code. */
export type RedemptionRefusal =
  | { kind: 'not_recognised' }
  | { kind: 'unavailable_try_again' }
  | {
      kind: 'refused';
      status: 400 | 409 | 429 | 503;
      error:
        | 'existing_account'
        | 'used'
        | 'revoked'
        | 'expired'
        | 'unavailable'
        | 'paid_invites_not_available'
        | 'signup_in_progress'
        | 'try_again'
        | 'code_recently_sent'
        | 'code_limit_reached'
        | 'code_not_sent'
        | 'code_expired'
        | 'code_locked'
        | 'code_invalid'
        | 'weak_password';
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
    };

export type RequestCodeOutcome =
  | { ok: true; codeExpiresAt: string; resendAvailableAt: string }
  | ({ ok: false } & RedemptionRefusal);

export type CompleteSignupOutcome =
  | { ok: true; email: string; accountId: string; inviteId: string }
  | ({ ok: false } & RedemptionRefusal);

type Refusal = { ok: false } & RedemptionRefusal;

const NOT_RECOGNISED: Refusal = { ok: false, kind: 'not_recognised' };
const TRY_AGAIN_LATER: Refusal = { ok: false, kind: 'unavailable_try_again' };

function refuse(
  status: 400 | 409 | 429 | 503,
  error: Extract<RedemptionRefusal, { kind: 'refused' }>['error'],
  extra: { attemptsRemaining?: number; retryAfterSeconds?: number } = {}
): Refusal {
  return { ok: false, kind: 'refused', status, error, ...extra };
}

// ── The shared checks ───────────────────────────────────────────────────────

type Loaded = { ok: true; row: BusinessOsInviteRedemptionView } | Refusal;

/**
 * Token → a pending, redeemable, champion invite whose email has no account.
 *
 * `allowStaleClaimWithAccount`: the complete route lets I-6 decide when a
 * LAPSED claim exists (the account may be this invite's own, from an
 * interrupted attempt). The code route never does (SA D-6).
 */
async function loadRedeemableInvite(
  token: string,
  deps: RedemptionDeps,
  now: Date,
  options: { allowStaleClaimWithAccount: boolean }
): Promise<Loaded> {
  if (!isWellFormedInviteToken(token)) return NOT_RECOGNISED;

  const found = await deps.invites.findByTokenHashForRedemption(hashInviteToken(token));
  if (found.error) return TRY_AGAIN_LATER;
  const row = found.data;
  if (!row) return NOT_RECOGNISED;

  const state = deriveInviteState(row, now);
  if (state === 'accepted') return refuse(409, 'used');
  if (state === 'revoked') return refuse(409, 'revoked');
  if (state === 'expired') return refuse(409, 'expired');

  // SA D-1: a live claim answers before any code check.
  if (isClaimLive(row.claimed_at, now)) return refuse(409, 'signup_in_progress');

  // GR-1, GR-3, T-15, R-5: re-checked at redemption, from the row and config only.
  if (row.grant_kind === 'tier') return refuse(409, 'paid_invites_not_available');
  const allowedTypes: readonly InviteTypeId[] = row.issuer_kind === 'admin' ? INVITE_ISSUANCE_POLICY.admin : [];
  if (
    row.invite_type !== CHAMPION_INVITE_TYPE ||
    !allowedTypes.includes(CHAMPION_INVITE_TYPE) ||
    !isInviteGrantAvailable(deps.config, row) ||
    !isRedeemableCohortGrant(deps.config, row)
  ) {
    return refuse(409, 'unavailable');
  }

  const hasStaleClaim = row.claimed_account_id !== null;
  if (!(options.allowStaleClaimWithAccount && hasStaleClaim)) {
    const account = await deps.accounts.emailHasAccount(row.email);
    if (account.error || typeof account.data !== 'boolean') return TRY_AGAIN_LATER;
    if (account.data) {
      const marked = await deps.invites.markOpenedByExistingAccount(row.id, now);
      if (marked.data === true) {
        await deps.audit({
          action: 'BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT',
          inviteId: row.id,
          accountId: null,
          details: {},
        });
      }
      return refuse(409, 'existing_account');
    }
  }

  return { ok: true, row };
}

// ── Request a code ──────────────────────────────────────────────────────────

export async function requestSignupCode(token: string, deps: RedemptionDeps): Promise<RequestCodeOutcome> {
  const now = deps.now();
  const loaded = await loadRedeemableInvite(token, deps, now, { allowStaleClaimWithAccount: false });
  if (!loaded.ok) return loaded;
  const { row } = loaded;

  const decision = decideCodeIssue(row, now);
  if (!decision.ok) return refuse(429, decision.reason, { retryAfterSeconds: decision.retryAfterSeconds });

  const code = generateSignupCode();
  const stored = await deps.invites.issueSignupCode({
    id: row.id,
    observedSentCount: row.signup_code_sent_count,
    observedLastSentAt: row.signup_code_last_sent_at,
    claimLeaseCutoff: claimLeaseCutoff(now),
    codeHash: hashSignupCode(row.id, code),
    expiresAt: decision.expiresAt,
    sentCount: decision.sentCount,
    windowStartedAt: decision.windowStartedAt,
    now,
  });
  if (stored.error) return TRY_AGAIN_LATER;
  if (!stored.data) return refuse(409, 'try_again');

  // The send counts against the cap even if it fails: a flaky inbox must not
  // become unlimited sends.
  const sent = await deps.sendCode({ to: row.email, code, language: isValidLocale(row.language) ? row.language : defaultLocale });
  if (!sent.sent) {
    deps.logger.warn({ inviteId: row.id }, 'Signup code email was not sent');
    return refuse(503, 'code_not_sent');
  }

  deps.logger.info({ inviteId: row.id, sentInWindow: decision.sentCount }, 'Signup code sent');
  return { ok: true, codeExpiresAt: decision.expiresAt.toISOString(), resendAvailableAt: decision.resendAvailableAt.toISOString() };
}

// ── Complete the signup ─────────────────────────────────────────────────────

export async function completeSignup(
  input: { token: string; signupCode: string; password: string },
  deps: RedemptionDeps
): Promise<CompleteSignupOutcome> {
  const now = deps.now();
  const loaded = await loadRedeemableInvite(input.token, deps, now, { allowStaleClaimWithAccount: true });
  if (!loaded.ok) return loaded;
  const { row } = loaded;

  // T-5 / D-5: the attempt is counted BEFORE the code is compared.
  const attempt = decideCodeAttempt(row, now);
  if (!attempt.ok) return refuse(409, attempt.reason);
  const codeHash = row.signup_code_hash as string;

  const counted = await deps.invites.countSignupCodeAttempt({
    id: row.id,
    observedAttempts: attempt.observedAttempts,
    codeHash,
    now,
  });
  if (counted.error) return TRY_AGAIN_LATER;
  if (!counted.data) return refuse(409, 'try_again');

  if (!signupCodeMatches(codeHash, row.id, input.signupCode)) {
    if (attempt.attemptsRemainingAfter === 0) {
      await deps.audit({
        action: 'BOS_INVITE_REDEMPTION_REFUSED',
        inviteId: row.id,
        accountId: null,
        details: { reason: 'code_attempts_exhausted' },
      });
    }
    return refuse(409, 'code_invalid', { attemptsRemaining: attempt.attemptsRemainingAfter });
  }

  // R-1 / I-3 / I-6: the account id is generated HERE, or reused from a lapsed claim.
  const accountId = row.claimed_account_id ?? deps.newAccountId();
  const claimed = await deps.invites.claimForSignup({
    id: row.id,
    codeHash,
    accountId,
    observedClaimedAccountId: row.claimed_account_id,
    now,
    claimLeaseCutoff: claimLeaseCutoff(now),
  });
  if (claimed.error) return TRY_AGAIN_LATER;
  if (!claimed.data) return refuse(409, 'try_again');

  const created = await deps.accounts.createConfirmedUser({ id: accountId, email: row.email, password: input.password });

  if (created.ok) {
    if (created.id !== accountId) {
      // I-3 / D-dev-3: never finalise an account we did not ask for. Keep the
      // claim; record the RETURNED id so the unexplained account stays findable.
      deps.logger.error({ inviteId: row.id, accountId, returnedAccountId: created.id }, 'Created account id differs from the claimed id');
      await stopWithClaimKept(row, accountId, deps, now, {
        step: 'create_user_id_mismatch',
        errorCode: null,
        errorMessage: 'created account id differs from the claimed id',
        failedAccountId: created.id,
      });
      return TRY_AGAIN_LATER;
    }
    return finish(row, accountId, deps, now);
  }

  if (created.kind === 'weak_password') {
    // A clean refusal: no user was created. Release, and let them choose again.
    await deps.invites.releaseSignupClaim(row.id, accountId, now);
    return refuse(400, 'weak_password');
  }

  // email_exists, or any other failure (a timeout can hide a created user):
  // ask whether the user at OUR id exists before doing anything (D-dev-2).
  const exists = await deps.accounts.findUserExists(accountId);
  if (exists.error || typeof exists.data !== 'boolean') {
    // Never release on uncertainty: keeping is safe, a re-claim reuses the id.
    await stopWithClaimKept(row, accountId, deps, now, {
      step: 'find_user',
      errorCode: created.code,
      errorMessage: created.message,
      failedAccountId: accountId,
    });
    return TRY_AGAIN_LATER;
  }

  if (exists.data) {
    // Our own account from an interrupted attempt (race-only, SA D-6): finish it.
    return finish(row, accountId, deps, now);
  }

  await deps.invites.releaseSignupClaim(row.id, accountId, now);
  if (created.kind === 'email_exists') {
    await deps.audit({
      action: 'BOS_INVITE_REDEMPTION_REFUSED',
      inviteId: row.id,
      accountId: null,
      details: { reason: 'existing_account' },
    });
    return refuse(409, 'existing_account');
  }
  deps.logger.warn({ inviteId: row.id, authErrorCode: created.code }, 'Account creation failed; claim released');
  return TRY_AGAIN_LATER;
}

/** Finalise (retried once, I-5), then audit the redemption. */
async function finish(
  row: BusinessOsInviteRedemptionView,
  accountId: string,
  deps: RedemptionDeps,
  now: Date
): Promise<CompleteSignupOutcome> {
  const call = () => deps.finalise({ inviteId: row.id, accountId, email: row.email, cohort: row.grant_id });

  let result = await call();
  if (result.error || !result.data) result = await call();

  if (result.error || !result.data) {
    const code = (result.error as (Error & { code?: string }) | null)?.code ?? null;
    await stopWithClaimKept(row, accountId, deps, now, {
      step: 'finalise',
      errorCode: code,
      errorMessage: result.error ? result.error.message : 'finalise matched no invite row',
      failedAccountId: accountId,
    });
    return TRY_AGAIN_LATER;
  }

  await deps.audit({
    action: 'BOS_INVITE_REDEEMED',
    inviteId: row.id,
    accountId,
    details: { inviteType: row.invite_type, level: 1, source: 'admin_invite' },
  });
  await deps.audit({
    action: 'BOS_INVITE_PLAN_PROVISIONED',
    inviteId: row.id,
    accountId,
    details: {
      grantKind: row.grant_kind,
      grantId: row.grant_id,
      accessOpenEnded: row.access_open_ended,
      accessMonths: row.access_months,
      origin: 'invite',
    },
  });
  deps.logger.info({ inviteId: row.id, accountId }, 'Invite redeemed');
  return { ok: true, email: row.email, accountId, inviteId: row.id };
}

/**
 * The claim is KEPT: write the FR-12a record (SA D-2) and audit it. The
 * message is scrubbed of anything email-shaped and cut to 300 characters; the
 * audit repeats exactly the record's fields plus the invite id.
 */
async function stopWithClaimKept(
  row: BusinessOsInviteRedemptionView,
  claimedAccountId: string,
  deps: RedemptionDeps,
  now: Date,
  failure: { step: RedemptionFailureStep; errorCode: string | null; errorMessage: string | null; failedAccountId: string | null }
): Promise<void> {
  const errorCode = failure.errorCode ? failure.errorCode.slice(0, 64) : null;
  const errorMessage = scrubFailureMessage(failure.errorMessage);

  const recorded = await deps.invites.recordRedemptionFailure({
    id: row.id,
    claimedAccountId,
    step: failure.step,
    errorCode,
    errorMessage,
    failedAccountId: failure.failedAccountId,
    now,
  });
  if (recorded.error || !recorded.data) {
    deps.logger.error({ inviteId: row.id, step: failure.step }, 'Could not record a stopped signup');
  }

  await deps.audit({
    action: 'BOS_INVITE_REDEMPTION_INCOMPLETE',
    inviteId: row.id,
    accountId: failure.failedAccountId,
    details: {
      redemptionFailedAt: now.toISOString(),
      redemptionFailedStep: failure.step,
      redemptionErrorCode: errorCode,
      redemptionErrorMessage: errorMessage,
      redemptionFailedAccountId: failure.failedAccountId,
    },
  });
  deps.logger.warn({ inviteId: row.id, step: failure.step }, 'Signup stopped halfway; claim kept');
}
