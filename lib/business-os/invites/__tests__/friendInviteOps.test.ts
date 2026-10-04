/**
 * Friend invites from a champion account, without a request (Slice 5a;
 * requirement §17 T-17 to T-21, F5a-6 to F5a-9, F5a-14; SA R-1, R-3, R-7).
 *
 * Pinned here: eligibility is the switch then the plan row (never the
 * resolver); the counted predicate mirrors migration 20261023 exactly; the
 * status a champion sees; the send order (switch before any read, own address
 * before the token and the SQL call); the SQL call's arguments are exactly the
 * allow-list; each refusal's status; a nameless champion is "AgentPilot",
 * never their email; and revoke is scoped to the session account.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  FRIEND_INVITE_LIMITS,
  INVITE_ISSUANCE_POLICY,
  INVITE_LINK_EXPIRY,
} from '@/lib/business-os/entitlements/config/invites';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { BusinessOsFriendInviteListRow, CreateFriendInviteInput, CreateFriendInviteResult } from '@/lib/repositories/types';
import { platformUrl } from '@/lib/utils/origins';

import {
  FRIEND_INVITE_INTERNAL_REASON,
  FRIEND_INVITE_REFUSAL_STATUS,
  FRIEND_INVITE_REVOKE_REASON,
  FRIEND_INVITE_VIEW_KEYS,
  INVITER_NAME_FALLBACK,
  friendInviteRefusalMessage,
  friendInviteStatus,
  getFriendInviteSummary,
  isCountedFriendInvite,
  isInForceChampion,
  remainingAllowance,
  revokeFriendInvite,
  sendFriendInvite,
  toFriendInviteView,
  type IssuerPlanFacts,
  type SendFriendInviteDeps,
} from '../friendInviteOps';
import { sendFriendInviteSchema } from '../inviteSchemas';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_EMAIL = 'Dana.Champion@Example.com';
const SENDER = 'invites@agentspilot.ai';
const config = getEntitlementConfig();
const policy = INVITE_ISSUANCE_POLICY as unknown as { accountInvitesAvailable: boolean };
// Restore the value the config shipped with, not a hardcoded one: the switch
// has been on in production since Slice 5b, and a hook that forced `false`
// leaked a state the real config no longer has into every later test.
const shippedSwitch = INVITE_ISSUANCE_POLICY.accountInvitesAvailable;
const COHORT = INVITE_ISSUANCE_POLICY.account.issuerCohort;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

afterEach(() => {
  policy.accountInvitesAvailable = shippedSwitch;
});

function row(overrides: Partial<BusinessOsFriendInviteListRow> = {}): BusinessOsFriendInviteListRow {
  return {
    id: INVITE_ID,
    email: 'friend@example.com',
    created_at: at(-86_400_000),
    link_expires_at: at(29 * 86_400_000),
    revoked_at: null,
    redeemed_at: null,
    claimed_account_id: null,
    ...overrides,
  };
}

// ── The count (T-17) ────────────────────────────────────────────────────────

describe('isCountedFriendInvite mirrors the SQL predicate in migration 20261023', () => {
  it('the migration counts with exactly this predicate', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261023_business_os_friend_invites.sql'), 'utf8').replace(/\s+/g, ' ');
    expect(sql).toContain(
      'invite_row.revoked_at IS NULL AND (invite_row.redeemed_at IS NOT NULL OR invite_row.claimed_account_id IS NOT NULL OR invite_row.link_expires_at > now())'
    );
  });

  it.each([
    ['pending (unexpired)', {}, true],
    ['expired', { link_expires_at: at(-1000) }, false],
    ['expiring exactly now (not > now)', { link_expires_at: NOW.toISOString() }, false],
    ['revoked', { revoked_at: at(-1000) }, false],
    ['accepted', { redeemed_at: at(-1000), link_expires_at: at(-500) }, true],
    ['claimed past expiry (holds its slot)', { claimed_account_id: ACCOUNT, link_expires_at: at(-1000) }, true],
    ['revoked while claimed', { claimed_account_id: ACCOUNT, revoked_at: at(-1000) }, false],
    ['an unreadable expiry', { link_expires_at: 'not-a-date' }, false],
  ] as const)('%s → %s', (_label, overrides, counted) => {
    expect(isCountedFriendInvite(row(overrides), NOW)).toBe(counted);
  });

  it('remaining = allowance − counted, never below 0 (D-8)', () => {
    const allowance = FRIEND_INVITE_LIMITS.lifetimeAllowance;
    expect(remainingAllowance([], NOW)).toBe(allowance);
    expect(remainingAllowance([row(), row({ revoked_at: at(-1) }), row({ link_expires_at: at(-1) })], NOW)).toBe(allowance - 1);
    expect(remainingAllowance(Array.from({ length: allowance + 3 }, () => row()), NOW)).toBe(0);
  });
});

describe('status and view (FR-31, F5a-9)', () => {
  it.each([
    [{}, 'pending', false],
    [{ link_expires_at: at(-1) }, 'expired', true],
    [{ revoked_at: at(-1) }, 'revoked', true],
    [{ redeemed_at: at(-1) }, 'joined', false],
    [{ claimed_account_id: ACCOUNT, link_expires_at: at(-1) }, 'pending', false],
  ] as const)('%o → %s (slot returned: %s)', (overrides, status, slotReturned) => {
    expect(friendInviteStatus(row(overrides), NOW)).toBe(status);
    expect(toFriendInviteView(row(overrides), NOW)).toMatchObject({ status, slotReturned });
  });

  it('the view carries exactly the allow-listed keys, never the claimant or the raw timestamps', () => {
    const view = toFriendInviteView(row({ claimed_account_id: ACCOUNT }), NOW);
    expect(Object.keys(view).sort()).toEqual([...FRIEND_INVITE_VIEW_KEYS].sort());
    expect(JSON.stringify(view)).not.toContain(ACCOUNT);
  });
});

describe('isInForceChampion (T-17 mode: the plan row, never the resolver)', () => {
  const plan = (overrides: Partial<IssuerPlanFacts> = {}): IssuerPlanFacts => ({ cohort: COHORT, cohort_expires_at: null, ...overrides });

  it.each([
    ['an open-ended champion', plan(), true],
    ['a champion ending later', plan({ cohort_expires_at: at(1000) }), true],
    ['a lapsed champion', plan({ cohort_expires_at: at(-1000) }), false],
    ['a champion ending exactly now', plan({ cohort_expires_at: NOW.toISOString() }), false],
    ['another cohort', plan({ cohort: 'some-other-cohort' }), false],
    ['no cohort (a tier-only account)', plan({ cohort: null }), false],
    ['no plan row', null, false],
    ['an unreadable end date', plan({ cohort_expires_at: 'garbage' }), false],
  ])('%s → %s', (_label, facts, expected) => {
    expect(isInForceChampion(facts, NOW)).toBe(expected);
  });
});

// ── Harness ─────────────────────────────────────────────────────────────────

interface HarnessOptions {
  plan?: IssuerPlanFacts | null;
  planError?: boolean;
  fullName?: string | null;
  profileError?: boolean;
  result?: CreateFriendInviteResult;
  rpcError?: boolean;
  emailResult?: SendEmailResult;
  sessionEmail?: string | null;
}

function harness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const rpcCalls: CreateFriendInviteInput[] = [];
  const sent: SendEmailParams[] = [];
  const plan = options.plan === undefined ? { cohort: COHORT, cohort_expires_at: null } : options.plan;

  const deps: SendFriendInviteDeps = {
    accountId: ACCOUNT,
    sessionEmail: options.sessionEmail === undefined ? SESSION_EMAIL : options.sessionEmail,
    plans: {
      findEntitlementInputs: jest.fn(async () => {
        order.push('plan');
        return options.planError ? { data: null, error: new Error('read failed') } : { data: { plan }, error: null };
      }),
    },
    repository: {
      createForIssuerAccount: jest.fn(async (input: CreateFriendInviteInput) => {
        order.push('rpc');
        rpcCalls.push(input);
        if (options.rpcError) return { data: null, error: new Error('rpc failed') };
        return {
          data: options.result ?? { outcome: 'created' as const, inviteId: INVITE_ID, linkExpiresAt: at(30 * 86_400_000) },
          error: null,
        };
      }),
      recordInviteEmailOutcome: jest.fn(async () => ({ data: true, error: null })),
    },
    profileRepository: {
      findById: jest.fn(async () => {
        order.push('profile');
        if (options.profileError) return { data: null, error: new Error('profile read failed') };
        return { data: { id: ACCOUNT, full_name: options.fullName === undefined ? 'Dana Champion' : options.fullName }, error: null } as never;
      }),
    },
    config,
    now: NOW,
    logger: { info: () => undefined, warn: () => undefined },
    email: {
      sendEmail: jest.fn(async (params: SendEmailParams) => {
        order.push('email');
        sent.push(params);
        return options.emailResult ?? { sent: true, provider: 'resend' as const, providerMessageId: 'msg_1' };
      }),
      senderAddress: () => SENDER,
      now: () => NOW,
      logger: { info: () => undefined, warn: () => undefined },
    },
  };
  return { deps, order, rpcCalls, sent };
}

const body = (overrides: Record<string, unknown> = {}) =>
  sendFriendInviteSchema.parse({ email: 'Friend@Example.com ', language: 'he', personalNote: 'Come and see', ...overrides });

// ── Summary (GET) ───────────────────────────────────────────────────────────

describe('getFriendInviteSummary', () => {
  const summaryDeps = (h: ReturnType<typeof harness>, rows: BusinessOsFriendInviteListRow[] = [row()]) => ({
    accountId: ACCOUNT,
    plans: h.deps.plans,
    repository: { listForIssuerAccount: jest.fn(async () => ({ data: rows, error: null })) },
    preferences: { findPreferredLanguage: jest.fn(async () => ({ data: 'es' as const, error: null })) },
    listLimit: 200,
    now: NOW,
    logger: { info: () => undefined, warn: () => undefined },
  });

  it('switch off: not eligible, and no database read at all', async () => {
    policy.accountInvitesAvailable = false;
    const h = harness();
    const deps = summaryDeps(h);
    expect(await getFriendInviteSummary(deps)).toEqual({ ok: true, summary: { eligible: false } });
    expect(h.deps.plans.findEntitlementInputs).not.toHaveBeenCalled();
    expect(deps.repository.listForIssuerAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['a trial account', { cohort: 'trial', cohort_expires_at: null }],
    ['an Essentials account (no cohort)', { cohort: null, cohort_expires_at: null }],
    ['a lapsed champion', { cohort: COHORT, cohort_expires_at: at(-1) }],
  ])('switch on, %s: not eligible, and the list is never read', async (_label, plan) => {
    policy.accountInvitesAvailable = true;
    const h = harness({ plan });
    const deps = summaryDeps(h);
    expect(await getFriendInviteSummary(deps)).toEqual({ ok: true, summary: { eligible: false } });
    expect(deps.repository.listForIssuerAccount).not.toHaveBeenCalled();
  });

  it('switch on, an in-force champion: the allowance, what is left, the language default and the list', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness();
    const deps = summaryDeps(h, [row(), row({ id: 'b', revoked_at: at(-1) })]);
    const outcome = await getFriendInviteSummary(deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.summary.eligible) throw new Error('expected an eligible summary');
    expect(outcome.summary).toMatchObject({
      eligible: true,
      allowance: FRIEND_INVITE_LIMITS.lifetimeAllowance,
      remaining: FRIEND_INVITE_LIMITS.lifetimeAllowance - 1,
      defaultLanguage: 'es',
      truncated: false,
    });
    expect(deps.repository.listForIssuerAccount).toHaveBeenCalledWith(ACCOUNT, { limit: 200 });
    expect(outcome.summary.invites.map((invite) => invite.status)).toEqual(['pending', 'revoked']);
  });

  it('a failed plan read is an error, never "not eligible" by default', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness({ planError: true });
    expect(await getFriendInviteSummary(summaryDeps(h))).toEqual({ ok: false });
  });
});

// ── Send (POST) ─────────────────────────────────────────────────────────────

describe('sendFriendInvite', () => {
  it('switch off: 403 not_eligible before ANY read or write', async () => {
    policy.accountInvitesAvailable = false;
    const h = harness();
    expect(await sendFriendInvite(body(), h.deps)).toEqual({ ok: false, status: 403, refusal: 'not_eligible' });
    expect(h.order).toEqual([]);
  });

  it.each([
    ['a trial account', { cohort: 'trial', cohort_expires_at: null }],
    ['a lapsed champion', { cohort: COHORT, cohort_expires_at: at(-1) }],
    ['no plan row', null],
  ])('switch on, %s: 403 not_eligible, and the SQL function is never called', async (_label, plan) => {
    policy.accountInvitesAvailable = true;
    const h = harness({ plan });
    expect(await sendFriendInvite(body(), h.deps)).toEqual({ ok: false, status: 403, refusal: 'not_eligible' });
    expect(h.order).toEqual(['plan']);
  });

  it.each([SESSION_EMAIL, `  ${SESSION_EMAIL.toUpperCase()} `, SESSION_EMAIL.toLowerCase()])(
    'own address %p: 409 own_email before the name, the token or the SQL call',
    async (email) => {
      policy.accountInvitesAvailable = true;
      const h = harness();
      expect(await sendFriendInvite(body({ email }), h.deps)).toEqual({ ok: false, status: 409, refusal: 'own_email' });
      expect(h.order).toEqual(['plan']);
    }
  );

  it('a champion may invite a +alias of their own mailbox (a different address)', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness();
    const outcome = await sendFriendInvite(body({ email: 'dana.champion+friend@example.com' }), h.deps);
    expect(outcome.ok).toBe(true);
  });

  it('calls the SQL function with exactly the allow-list: issuer from the session, the rest from config', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness();
    const outcome = await sendFriendInvite(body(), h.deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(h.order).toEqual(['plan', 'profile', 'rpc', 'email']);
    expect(h.rpcCalls).toHaveLength(1);
    const call = h.rpcCalls[0];
    const token = outcome.link.slice(`${platformUrl('/invite')}#t=`.length);
    expect(call).toEqual({
      issuerAccountId: ACCOUNT,
      issuerCohort: INVITE_ISSUANCE_POLICY.account.issuerCohort,
      inviteType: INVITE_ISSUANCE_POLICY.account.inviteType,
      grantId: INVITE_ISSUANCE_POLICY.account.grantId,
      allowance: FRIEND_INVITE_LIMITS.lifetimeAllowance,
      dailyLimit: FRIEND_INVITE_LIMITS.dailySendLimit,
      dailyWindowHours: FRIEND_INVITE_LIMITS.dailyWindowHours,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      email: 'friend@example.com',
      inviterDisplayName: 'Dana Champion',
      inviterReplyTo: SESSION_EMAIL.toLowerCase(),
      language: 'he',
      personalNote: 'Come and see',
      internalReason: FRIEND_INVITE_INTERNAL_REASON,
      linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    });
    expect(outcome.invite).toEqual({
      id: INVITE_ID,
      email: 'friend@example.com',
      createdAt: NOW.toISOString(),
      linkExpiresAt: at(30 * 86_400_000),
      status: 'pending',
      slotReturned: false,
    });
  });

  it('emails through the existing 2a path: "<Champion> via AgentPilot", Reply-To the champion, payment required', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness();
    const outcome = await sendFriendInvite(body(), h.deps);
    expect(outcome.ok && outcome.email.status).toBe('sent');
    expect(h.sent).toHaveLength(1);
    const email = h.sent[0] as SendEmailParams & { from?: string; replyTo?: string };
    expect(email.to).toEqual(['friend@example.com']);
    expect(email.from).toBe(`"Dana Champion via AgentPilot" <${SENDER}>`);
    expect(email.replyTo).toBe(SESSION_EMAIL.toLowerCase());
    expect(email.kind).toBe('transactional');
    expect(String(email.html)).toContain(planLabel(config, INVITE_ISSUANCE_POLICY.account.grantId));
  });

  it.each([
    ['no name on the profile', { fullName: null }],
    ['a blank name', { fullName: '   ' }],
    ['a failed profile read', { profileError: true }],
  ])('SA R-1: %s → "AgentPilot", never the champion\'s email', async (_label, options) => {
    policy.accountInvitesAvailable = true;
    const h = harness(options);
    await sendFriendInvite(body(), h.deps);
    const name = h.rpcCalls[0].inviterDisplayName;
    expect(name).toBe(INVITER_NAME_FALLBACK);
    expect(name).not.toContain('@');
    expect(name.toLowerCase()).not.toContain(SESSION_EMAIL.toLowerCase());
    const email = h.sent[0] as SendEmailParams & { from?: string };
    expect(email.from).toBe(`AgentPilot <${SENDER}>`);
  });

  it('an empty note is stored as NULL (SA R-7)', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness();
    await sendFriendInvite(body({ personalNote: '   ' }), h.deps);
    expect(h.rpcCalls[0].personalNote).toBeNull();
  });

  it.each([
    ['allowance_reached', 409],
    ['already_invited', 409],
    ['daily_limit', 429],
    ['not_eligible', 403],
  ] as const)('the SQL refusal %s → %s, and no email is sent', async (refusal, status) => {
    policy.accountInvitesAvailable = true;
    const h = harness({ result: { outcome: refusal } });
    expect(await sendFriendInvite(body(), h.deps)).toEqual({ ok: false, status, refusal });
    expect(h.sent).toEqual([]);
    expect(FRIEND_INVITE_REFUSAL_STATUS[refusal]).toBe(status);
  });

  it('a failed SQL call is a 500 with no refusal class', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness({ rpcError: true });
    expect(await sendFriendInvite(body(), h.deps)).toEqual({ ok: false, status: 500, refusal: null });
  });

  it('FR-16: a failed email never fails the send, and the link is still returned', async () => {
    policy.accountInvitesAvailable = true;
    const h = harness({ emailResult: { sent: false, provider: 'none', error: 'down' } });
    const outcome = await sendFriendInvite(body(), h.deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.email.status).toBe('not_sent');
    expect(outcome.ok && outcome.link.startsWith(platformUrl('/invite'))).toBe(true);
  });
});

describe('refusal messages (T-21, SA R-7)', () => {
  it('each refusal has its own message, and the allowance comes from config', () => {
    const messages = (['not_eligible', 'own_email', 'allowance_reached', 'already_invited', 'daily_limit'] as const).map(friendInviteRefusalMessage);
    expect(new Set(messages).size).toBe(messages.length);
    expect(friendInviteRefusalMessage('allowance_reached')).toBe(`All ${FRIEND_INVITE_LIMITS.lifetimeAllowance} of your invites are in use.`);
    expect(friendInviteRefusalMessage('daily_limit')).not.toMatch(/\d/);
  });
});

// ── Revoke ──────────────────────────────────────────────────────────────────

describe('revokeFriendInvite (F5a-8, SA Q-2; 409 from Slice 5b)', () => {
  const revoke = (
    data: boolean | null,
    error: Error | null = null,
    redeemed: { data: boolean | null; error: Error | null } = { data: false, error: null }
  ) => ({
    revokeForIssuerAccount: jest.fn(async () => ({ data, error })),
    findRedeemedForIssuerAccount: jest.fn(async () => redeemed),
  });

  it('is scoped to the session account, with the fixed reason and the claim lease, even with the switch off', async () => {
    const repository = revoke(true);
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: true });
    expect(repository.revokeForIssuerAccount).toHaveBeenCalledWith({
      id: INVITE_ID,
      issuerAccountId: ACCOUNT,
      reason: FRIEND_INVITE_REVOKE_REASON,
      now: NOW,
      claimLeaseCutoff: expect.any(Date),
    });
    // A won revoke needs no second read.
    expect(repository.findRedeemedForIssuerAccount).not.toHaveBeenCalled();
  });

  it('0 rows and not accepted (not found, not yours, otherwise not revocable) → 404', async () => {
    const repository = revoke(false);
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: false, status: 404 });
    expect(repository.findRedeemedForIssuerAccount).toHaveBeenCalledWith(INVITE_ID, ACCOUNT);
  });

  it('0 rows and the caller’s OWN invite was accepted → 409 (5a Q-3)', async () => {
    const repository = revoke(false, null, { data: true, error: null });
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: false, status: 409 });
  });

  it('the second read carries the SESSION account, so another account’s accepted invite stays a 404', async () => {
    const OTHER = '99999999-9999-4999-8999-999999999999';
    // A repository that answers "accepted" only for the real issuer, as the scoped SELECT does.
    const repository = {
      revokeForIssuerAccount: jest.fn(async () => ({ data: false, error: null })),
      findRedeemedForIssuerAccount: jest.fn(async (_id: string, issuer: string) => ({ data: issuer === OTHER, error: null })),
    };
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: false, status: 404 });
    expect(repository.findRedeemedForIssuerAccount).toHaveBeenCalledWith(INVITE_ID, ACCOUNT);
  });

  it('a database error on the revoke → 500, with no second read', async () => {
    const repository = revoke(null, new Error('x'));
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: false, status: 500 });
    expect(repository.findRedeemedForIssuerAccount).not.toHaveBeenCalled();
  });

  it('a database error on the second read → 500, never a guessed 404 or 409', async () => {
    const repository = revoke(false, null, { data: null, error: new Error('timeout') });
    expect(await revokeFriendInvite({ accountId: ACCOUNT, inviteId: INVITE_ID, repository, now: NOW })).toEqual({ ok: false, status: 500 });
  });
});
