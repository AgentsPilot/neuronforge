import 'server-only';

/**
 * A champion signs up from an invite (invite-only signup, Slices 1b and 3b).
 *
 * Three operations, all reached only by the public signup routes:
 *
 *   requestSignupCode     token → a 6-digit code emailed to the invited address
 *   completeSignup        token + code + password → the account, the plan row,
 *                         the lineage row and the burned invite
 *   completeGoogleSignup  token + a verified Google ID token for the invited
 *                         address → the same, through the same claim → create
 *                         → finalise path (Slice 3b; only the proof differs)
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
 * the code and the password (the route's `.strict()` schema; for Google, the
 * token, the ID token and the nonce): the email, the grant, the account id and
 * the level all come from the row or from here.
 *
 * ── What is never written anywhere ──────────────────────────────────────────
 * The token, its hash, the code, the password, the Google ID token, its nonce,
 * and anything read from it (the Google email and `sub`). The email is used to create the
 * account and is returned to the browser only after a successful signup (F-6);
 * it is never logged, never audited, never stored in the failure record.
 *
 * ── A champion's FRIEND (Slice 5b; T-19, F5b-2, F5b-3, T-13) ───────────────
 * An account-issued invite takes its own, explicit branch in
 * `loadRedeemableInvite` (keyed on `issuer_kind = 'account'`, before the
 * generic tier refusal, which stays for admin Paid invites until 5c). It is
 * redeemable only while friend invites are switched on, only in the exact
 * shape the send writes (Paid, the config tier), and only while the issuer is
 * still an in-force champion (the TypeScript check; the SQL re-check decides).
 * Three differences from a champion:
 *   - the existing-account check runs only AFTER mailbox proof (the code
 *     matched, or the Google proof passed), because the champion holds the
 *     link and must not learn whether an address has an account. The code
 *     route stores a code either way and, for an existing account, emails a
 *     "sign in instead" notice rather than the code: the HTTP answer is the
 *     same (the decoy code, workplan D-3);
 *   - `finish` calls the FRIEND finalise, which writes a plan row with NO
 *     basis and the lineage at L2 (or the champion's level + 1);
 *   - the landing is the payment hold, never onboarding (FR-35).
 * Both signup methods reach the friend path through the shared
 * `createAndFinish`, so I-1 to I-6 and FR-12a hold for friends by construction.
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
import type {
  AuthAccountRepository,
  CreateConfirmedUserOutcome,
  CreatePasswordlessUserOutcome,
} from '@/lib/repositories/AuthAccountRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type {
  AgentRepositoryResult as RepositoryResult,
  BusinessOsInviteRedemptionView,
  FriendFinaliseOutcome,
} from '@/lib/repositories/types';

// Type-only: the verifier (and `google-auth-library` behind it) is injected
// through `RedemptionDeps`, never loaded by this module (SA Q-2).
import type { GoogleIdTokenVerification, VerifyGoogleIdToken } from './googleIdToken';
import { isInForceChampion, type IssuerPlanReader } from './friendInviteOps';
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
  | 'claimForGoogleSignup'
  | 'releaseSignupClaim'
  | 'recordRedemptionFailure'
  | 'markOpenedByExistingAccount'
>;

export type RedemptionAccounts = Pick<
  AuthAccountRepository,
  'emailHasAccount' | 'createConfirmedUser' | 'createConfirmedUserWithoutPassword' | 'findUserExists'
>;

/** The finalise call (the plan repository's `provisionFromInvite`, bound by the route). */
export type FinaliseRedemption = (input: {
  inviteId: string;
  accountId: string;
  email: string;
  cohort: string;
}) => Promise<RepositoryResult<string>>;

/** The friend finalise (the plan repository's `provisionFromFriendInvite`, bound by the route). Slice 5b. */
export type FinaliseFriendRedemption = (input: {
  inviteId: string;
  accountId: string;
  email: string;
  tierId: string;
  issuerCohort: string;
}) => Promise<RepositoryResult<FriendFinaliseOutcome>>;

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

/** What a system email send reports back (code email, existing-account notice). */
export interface SystemEmailSendResult {
  sent: boolean;
  /** True only when nothing was attempted because the platform sender is not configured. */
  senderNotConfigured?: boolean;
}

export interface RedemptionDeps {
  invites: RedemptionInviteRepository;
  accounts: RedemptionAccounts;
  finalise: FinaliseRedemption;
  /** Slice 5b: the friend finalise (T-19). */
  finaliseFriend: FinaliseFriendRedemption;
  /** Slice 5b: the issuer's plan row, for the in-force champion re-check (T-19; the SQL re-check decides). */
  issuerPlans: IssuerPlanReader;
  /**
   * Sends the code email; never throws. The code is in the body only.
   * `senderNotConfigured`: nothing was attempted because the platform sender is
   * not configured (fail closed).
   */
  sendCode: (input: { to: string; code: string; language: string }) => Promise<SystemEmailSendResult>;
  /**
   * Slice 5b (F5b-3, SA R-5): the "you already have an account, sign in"
   * notice, sent INSTEAD of the code when a friend invite's address already
   * has an account. Never throws. Carries nothing from the champion.
   */
  sendExistingAccountNotice: (input: { to: string; language: string }) => Promise<SystemEmailSendResult>;
  audit: (entry: RedemptionAuditEntry) => Promise<void>;
  config: EntitlementConfig;
  now: () => Date;
  /** The server-side account id generator (I-3). `crypto.randomUUID` in production. */
  newAccountId: () => string;
  /**
   * Slice 3b: the Google ID-token verifier (`googleIdToken.ts`). Never throws
   * (SA R-1); returns the verified address or a fixed reason code only.
   */
  verifyGoogleIdToken: VerifyGoogleIdToken;
  logger: RedemptionLogger;
}

// ── Outcomes ────────────────────────────────────────────────────────────────

/** A refusal the route turns into a status and a machine-readable code. */
export type RedemptionRefusal =
  | { kind: 'not_recognised' }
  | { kind: 'unavailable_try_again' }
  | {
      kind: 'refused';
      status: 400 | 404 | 409 | 429 | 503;
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
        | 'weak_password'
        // Slice 3b (Google): none of these carries an address.
        | 'google_signin_not_configured'
        | 'google_token_invalid'
        | 'google_email_unverified'
        | 'google_use_code'
        | 'google_email_mismatch';
      attemptsRemaining?: number;
      retryAfterSeconds?: number;
    };

export type RequestCodeOutcome =
  | { ok: true; codeExpiresAt: string; resendAvailableAt: string }
  | ({ ok: false } & RedemptionRefusal);

/**
 * Where a new account goes next (FR-13, FR-35). A champion goes to onboarding;
 * a friend, who has not paid, to the payment hold (Slice 5b).
 */
export type RedemptionLanding = 'onboarding' | 'awaiting_payment';

export type CompleteSignupOutcome =
  | { ok: true; email: string; accountId: string; inviteId: string; landing: RedemptionLanding }
  | ({ ok: false } & RedemptionRefusal);

/** Slice 3b: no email on success. The browser signs in with Google's token, not an address. */
export type CompleteGoogleSignupOutcome =
  | { ok: true; accountId: string; inviteId: string; landing: RedemptionLanding }
  | ({ ok: false } & RedemptionRefusal);

type Refusal = { ok: false } & RedemptionRefusal;

function refuse(
  status: 400 | 404 | 409 | 429 | 503,
  error: Extract<RedemptionRefusal, { kind: 'refused' }>['error'],
  extra: { attemptsRemaining?: number; retryAfterSeconds?: number } = {}
): Refusal {
  return { ok: false, kind: 'refused', status, error, ...extra };
}

const NOT_RECOGNISED: Refusal = { ok: false, kind: 'not_recognised' };
const TRY_AGAIN_LATER: Refusal = { ok: false, kind: 'unavailable_try_again' };

// ── The shared checks ───────────────────────────────────────────────────────

/** Which finalise, and which landing: a champion (admin-issued) or a friend (account-issued, Slice 5b). */
export type RedemptionKind = 'champion' | 'friend';

type Loaded = { ok: true; row: BusinessOsInviteRedemptionView; kind: RedemptionKind } | Refusal;

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

  // Slice 5b (F5b-2): a champion's friend invite, keyed on who issued it. It
  // NEVER reaches the existing-account check here (F5b-3): that runs after
  // mailbox proof, in each entry point.
  if (row.issuer_kind === 'account') return loadFriendInvite(row, deps, now);

  // GR-1, GR-3, T-15, R-5: re-checked at redemption, from the row and config only.
  // Admin Paid invites stay refused until 5c (C-6); friend invites never get here.
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

  if (!(options.allowStaleClaimWithAccount && hasStaleClaimOn(row))) {
    const refused = await refuseIfEmailHasAccount(row, deps, now);
    if (refused) return refused;
  }

  return { ok: true, row, kind: 'champion' };
}

/** A lapsed claim exists: I-6 lets the account it names be this invite's own. */
function hasStaleClaimOn(row: BusinessOsInviteRedemptionView): boolean {
  return row.claimed_account_id !== null;
}

/**
 * FR-8a / L-3: does the invited address already have an account? `null` means
 * no (carry on). Otherwise the refusal: 409 `existing_account` (the delivery
 * fact stamped and audited once), or "try again" when the lookup failed, never
 * "no account" by default. A champion asks before any code (1b order); a
 * friend only after mailbox proof (F5b-3).
 */
async function refuseIfEmailHasAccount(
  row: BusinessOsInviteRedemptionView,
  deps: RedemptionDeps,
  now: Date
): Promise<Refusal | null> {
  const account = await deps.accounts.emailHasAccount(row.email);
  if (account.error || typeof account.data !== 'boolean') return TRY_AGAIN_LATER;
  if (!account.data) return null;
  await stampOpenedByExistingAccount(row, deps, now);
  return refuse(409, 'existing_account');
}

/** The FR-8a delivery fact, audited only when THIS call set it (D-13). */
async function stampOpenedByExistingAccount(row: BusinessOsInviteRedemptionView, deps: RedemptionDeps, now: Date): Promise<void> {
  const marked = await deps.invites.markOpenedByExistingAccount(row.id, now);
  if (marked.data === true) {
    await deps.audit({
      action: 'BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT',
      inviteId: row.id,
      accountId: null,
      details: {},
    });
  }
}

/**
 * Slice 5b (F5b-2, T-18, T-19): a champion's friend invite is redeemable only
 * while friend invites are switched on, only in the exact shape the send
 * writes (the Paid type, the config tier, still configured), and only while
 * the issuer is still an in-force champion. Any "no" is the existing
 * "no longer available" (`unavailable`), before any code, email, claim or
 * account. The issuer read failing is "try again". The SQL finalise re-checks
 * the issuer and is what decides.
 *
 * Deliberately NO existing-account check here (F5b-3).
 */
async function loadFriendInvite(row: BusinessOsInviteRedemptionView, deps: RedemptionDeps, now: Date): Promise<Loaded> {
  const policy = INVITE_ISSUANCE_POLICY.account;
  if (!INVITE_ISSUANCE_POLICY.accountInvitesAvailable) return refuse(409, 'unavailable');
  if (
    row.grant_kind !== 'tier' ||
    row.invite_type !== policy.inviteType ||
    row.grant_id !== policy.grantId ||
    !row.issuer_account_id ||
    !isInviteGrantAvailable(deps.config, row)
  ) {
    return refuse(409, 'unavailable');
  }

  const issuer = await deps.issuerPlans.findEntitlementInputs(row.issuer_account_id);
  if (issuer.error || !issuer.data) return TRY_AGAIN_LATER;
  if (!isInForceChampion(issuer.data.plan, now)) return refuse(409, 'unavailable');

  return { ok: true, row, kind: 'friend' };
}

// ── Request a code ──────────────────────────────────────────────────────────

export async function requestSignupCode(token: string, deps: RedemptionDeps): Promise<RequestCodeOutcome> {
  const now = deps.now();
  const loaded = await loadRedeemableInvite(token, deps, now, { allowStaleClaimWithAccount: false });
  if (!loaded.ok) return loaded;
  const { row, kind } = loaded;

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

  const language = isValidLocale(row.language) ? row.language : defaultLocale;

  // Slice 5b (F5b-3, the decoy code): for a friend invite the account question
  // is asked only NOW, after the code is stored and counted exactly as for a
  // new address. An existing account gets the "sign in instead" notice and the
  // stored code is never sent, so `complete` answers `code_invalid` for both
  // kinds of address. The HTTP answer below is the same either way.
  let hasAccount = false;
  if (kind === 'friend') {
    const account = await deps.accounts.emailHasAccount(row.email);
    if (account.error || typeof account.data !== 'boolean') return TRY_AGAIN_LATER;
    hasAccount = account.data;
  }

  // The send counts against the cap even if it fails: a flaky inbox must not
  // become unlimited sends.
  if (hasAccount) {
    const [notice] = await Promise.all([
      deps.sendExistingAccountNotice({ to: row.email, language }),
      // SA suggestion (residual c): alongside the send, not before it.
      stampOpenedByExistingAccount(row, deps, now),
    ]);
    // QA-1: the existing-account branch answers EXACTLY like a new address's
    // success, whether or not the notice went out. A 503 here, against a 200
    // for a new address, would tell the champion the address has an account.
    // The failure is logged at warn, keyed by the invite id only (no email).
    // The one exception: an unconfigured platform sender. Then the code email
    // cannot go out either, so every new address gets 503 `code_not_sent`; the
    // notice must answer the same, or the 200/503 split would itself be the
    // account oracle. Same refusal, same log line as the code branch below.
    if (notice.senderNotConfigured) {
      deps.logger.warn({ inviteId: row.id }, 'Signup code email was not sent');
      return refuse(503, 'code_not_sent');
    }
    if (!notice.sent) deps.logger.warn({ inviteId: row.id }, 'Existing-account notice was not sent');
  } else {
    const sent = await deps.sendCode({ to: row.email, code, language });
    // A new address's own code email failing is genuinely about that address
    // (the friend gets no code), so it stays 503 `code_not_sent`.
    if (!sent.sent) {
      deps.logger.warn({ inviteId: row.id }, 'Signup code email was not sent');
      return refuse(503, 'code_not_sent');
    }
  }

  // Logged identically for both branches: the log must not tell them apart either.
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
  const { row, kind } = loaded;

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

  // Slice 5b (F5b-3): a friend's existing-account check, now that the code
  // proved the mailbox. A lapsed claim keeps I-6's meaning.
  if (kind === 'friend' && !hasStaleClaimOn(row)) {
    const refused = await refuseIfEmailHasAccount(row, deps, now);
    if (refused) return refused;
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

  return createAndFinish(
    row,
    kind,
    accountId,
    () => deps.accounts.createConfirmedUser({ id: accountId, email: row.email, password: input.password }),
    'password',
    deps,
    now
  );
}

// ── Complete the signup with Google (Slice 3b) ──────────────────────────────

/**
 * Token + a Google ID token + the raw nonce → the same account, plan row,
 * lineage row and burned invite as `completeSignup` (FR-11, FR-12, D-2).
 *
 * Only the mailbox proof changes: a verified Google ID token for the invite's
 * OWN address replaces the emailed code. Everything else is shared:
 * `loadRedeemableInvite` (state, live claim, grant, existing account) runs
 * first, unchanged, and everything after the claim is `createAndFinish`.
 *
 * What the code limits do NOT apply here (D-8, SA Q-4): no code is issued or
 * compared, so neither counter is touched, and an invite locked after five
 * wrong codes may still be redeemed this way. The lock stops code guessing; a
 * verified Google proof is independent of the code.
 *
 * Order (SA R-2): verify (signature, nonce, iat, `email_verified`, the
 * authoritative-address rule) and only then compare addresses, so a refusal
 * for authority never reveals whether the addresses matched. Neither address
 * is ever logged, audited or returned; the only Google value kept is the
 * verified email, compared and then dropped (R-11). The account is created for
 * the ROW's email, never the token's (§3.4).
 */
export async function completeGoogleSignup(
  input: { token: string; idToken: string; nonce: string },
  deps: RedemptionDeps
): Promise<CompleteGoogleSignupOutcome> {
  const now = deps.now();
  const loaded = await loadRedeemableInvite(input.token, deps, now, { allowStaleClaimWithAccount: true });
  if (!loaded.ok) return loaded;
  const { row, kind } = loaded;

  const proof = await deps.verifyGoogleIdToken({ idToken: input.idToken, rawNonce: input.nonce });
  if (proof.kind !== 'ok') return refuseGoogleProof(proof, row, deps);

  // D-7 / BQ-2: exact and case-insensitive; no dot or +tag folding.
  if (proof.email !== row.email.trim().toLowerCase()) {
    await deps.audit({
      action: 'BOS_INVITE_REDEMPTION_REFUSED',
      inviteId: row.id,
      accountId: null,
      details: { reason: 'google_email_mismatch', method: 'google' },
    });
    deps.logger.info({ inviteId: row.id }, 'Google signup refused: the verified address is not the invited one');
    return refuse(409, 'google_email_mismatch');
  }

  // Slice 5b (F5b-3): a friend's existing-account check, now that Google proved
  // the mailbox. A lapsed claim keeps I-6's meaning.
  if (kind === 'friend' && !hasStaleClaimOn(row)) {
    const refused = await refuseIfEmailHasAccount(row, deps, now);
    if (refused) return refused;
  }

  // R-1 / I-3 / I-6: the account id is generated HERE, or reused from a lapsed claim.
  const accountId = row.claimed_account_id ?? deps.newAccountId();
  const claimed = await deps.invites.claimForGoogleSignup({
    id: row.id,
    accountId,
    observedClaimedAccountId: row.claimed_account_id,
    now,
    claimLeaseCutoff: claimLeaseCutoff(now),
  });
  if (claimed.error) return TRY_AGAIN_LATER;
  if (!claimed.data) return refuse(409, 'try_again');

  const finished = await createAndFinish(
    row,
    kind,
    accountId,
    () => deps.accounts.createConfirmedUserWithoutPassword({ id: accountId, email: row.email }),
    'google',
    deps,
    now
  );
  return finished.ok
    ? { ok: true, accountId: finished.accountId, inviteId: finished.inviteId, landing: finished.landing }
    : finished;
}

/**
 * A Google proof that did not pass, as a refusal. Exhaustive: a new verifier
 * outcome fails to compile here. `invalid` is logged with its fixed reason code
 * and not audited (noise, not an invite event); the two refusals that say
 * something about the invitee's Google account are audited, with no address.
 */
async function refuseGoogleProof(
  proof: Exclude<GoogleIdTokenVerification, { kind: 'ok' }>,
  row: BusinessOsInviteRedemptionView,
  deps: RedemptionDeps
): Promise<Refusal> {
  switch (proof.kind) {
    case 'not_configured':
      return refuse(404, 'google_signin_not_configured');
    case 'unavailable':
      deps.logger.warn({ inviteId: row.id }, 'Google certificates unavailable; signup not attempted');
      return TRY_AGAIN_LATER;
    case 'invalid':
      deps.logger.info({ inviteId: row.id, googleTokenRefusal: proof.reason }, 'Google ID token refused');
      return refuse(400, 'google_token_invalid');
    case 'unverified':
      await deps.audit({
        action: 'BOS_INVITE_REDEMPTION_REFUSED',
        inviteId: row.id,
        accountId: null,
        details: { reason: 'google_email_unverified', method: 'google' },
      });
      return refuse(409, 'google_email_unverified');
    case 'not_authoritative':
      await deps.audit({
        action: 'BOS_INVITE_REDEMPTION_REFUSED',
        inviteId: row.id,
        accountId: null,
        details: { reason: 'google_account_not_authoritative', method: 'google' },
      });
      return refuse(409, 'google_use_code');
    default: {
      const unhandled: never = proof;
      deps.logger.error({ inviteId: row.id, googleProof: String((unhandled as { kind?: unknown }).kind) }, 'Unknown Google proof outcome');
      return TRY_AGAIN_LATER;
    }
  }
}

/** How the mailbox was proven (D-11): recorded as `details.method` on `BOS_INVITE_REDEEMED`. */
export type RedemptionMethod = 'password' | 'google';

/**
 * Everything after a WON claim, shared by the code and the Google paths (D-2),
 * so I-1 to I-6 and FR-12a hold for both by construction: create the account
 * at the claimed id, then finish (finalise, retried once), or keep the claim
 * and record why, or release it only after a positive "no such user".
 *
 * `create` is the only thing that differs: with the chosen password, or with
 * none. Its outcome classes are the same, except that the password-less one
 * has no `weak_password` (that branch is reachable only from the code path).
 */
async function createAndFinish(
  row: BusinessOsInviteRedemptionView,
  kind: RedemptionKind,
  accountId: string,
  create: () => Promise<CreateConfirmedUserOutcome | CreatePasswordlessUserOutcome>,
  method: RedemptionMethod,
  deps: RedemptionDeps,
  now: Date
): Promise<CompleteSignupOutcome> {
  const created = await create();

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
    return finish(row, kind, accountId, method, deps, now);
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
    return finish(row, kind, accountId, method, deps, now);
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
  kind: RedemptionKind,
  accountId: string,
  method: RedemptionMethod,
  deps: RedemptionDeps,
  now: Date
): Promise<CompleteSignupOutcome> {
  if (kind === 'friend') return finishFriend(row, accountId, method, deps, now);

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
    details: { inviteType: row.invite_type, level: 1, source: 'admin_invite', method },
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
  return { ok: true, email: row.email, accountId, inviteId: row.id, landing: 'onboarding' };
}

/**
 * Slice 5b: the friend finalise (T-19), retried once like the champion's (I-5),
 * EXCEPT when the issuer is no longer an in-force champion: a retry cannot
 * change that, so the claim is kept at once and FR-12a names the cause
 * (`issuer_not_eligible`, SA Q-1). The account then exists with no plan row and
 * no lineage, is not held, and is recovered by hand (workplan §11, SA R-11).
 */
async function finishFriend(
  row: BusinessOsInviteRedemptionView,
  accountId: string,
  method: RedemptionMethod,
  deps: RedemptionDeps,
  now: Date
): Promise<CompleteSignupOutcome> {
  const policy = INVITE_ISSUANCE_POLICY.account;
  const call = () =>
    deps.finaliseFriend({
      inviteId: row.id,
      accountId,
      email: row.email,
      tierId: policy.grantId,
      issuerCohort: policy.issuerCohort,
    });

  type Answer = Awaited<ReturnType<typeof call>>;
  const isDone = (answer: Answer) =>
    !answer.error && (answer.data?.outcome === 'finalised' || answer.data?.outcome === 'already_finalised');
  const issuerLapsed = (answer: Answer) => !answer.error && answer.data?.outcome === 'issuer_not_eligible';

  let result = await call();
  if (!isDone(result) && !issuerLapsed(result)) result = await call();

  const done = result.data;
  if (result.error || !done || (done.outcome !== 'finalised' && done.outcome !== 'already_finalised')) {
    const lapsed = issuerLapsed(result);
    const code = lapsed ? 'issuer_not_eligible' : ((result.error as (Error & { code?: string }) | null)?.code ?? null);
    await stopWithClaimKept(row, accountId, deps, now, {
      step: 'finalise',
      errorCode: code,
      errorMessage: result.error
        ? result.error.message
        : lapsed
          ? 'the inviting account is no longer an in-force champion'
          : 'friend finalise matched no invite row',
      failedAccountId: accountId,
    });
    return TRY_AGAIN_LATER;
  }

  await deps.audit({
    action: 'BOS_INVITE_REDEEMED',
    inviteId: row.id,
    accountId,
    details: { inviteType: row.invite_type, level: done.level, source: 'account_invite', method },
  });
  await deps.audit({
    action: 'BOS_INVITE_PLAN_PROVISIONED',
    inviteId: row.id,
    accountId,
    details: {
      grantKind: row.grant_kind,
      grantId: row.grant_id,
      // T-13 layer 1: no cohort, no tier. The friend is held until they pay (BQ-13).
      basis: 'none',
      awaitingPayment: true,
      origin: 'invite',
    },
  });
  deps.logger.info({ inviteId: row.id, accountId, level: done.level }, 'Friend invite redeemed; account held until payment');
  return { ok: true, email: row.email, accountId, inviteId: row.id, landing: 'awaiting_payment' };
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
