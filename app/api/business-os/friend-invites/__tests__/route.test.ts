/**
 * `GET` / `POST /api/business-os/friend-invites` (Slice 5a; F5a-5, F5a-13,
 * F5a-14, AC-16; SA R-3).
 *
 * The routes and the real `friendInviteOps` together; only the session, the
 * repositories, the email transport and the audit trail are fakes. Pinned:
 * 401 without a session; the account is the session's; the body is `.strict()`
 * and parsed BEFORE any business read (an injected plan, issuer, expiry, level
 * or account id is a 400 and nothing is written); 403 for a non-champion and
 * for the switch being off, neither of them audited (N-4, Slice 5b); the
 * other four refusals audited by class; the allowance and daily-limit refusals have
 * distinct statuses and messages; every response is `no-store`; and nothing
 * logged to the audit carries the friend's email or the link.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';

const CHAMPION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const COHORT = INVITE_ISSUANCE_POLICY.account.issuerCohort;
const policy = INVITE_ISSUANCE_POLICY as unknown as { accountInvitesAvailable: boolean };
// Restore the value the config shipped with, not a hardcoded one: the switch
// has been on in production since Slice 5b, and a hook that forced `false`
// leaked a state the real config no longer has into every later test.
const shippedSwitch = INVITE_ISSUANCE_POLICY.accountInvitesAvailable;

const state = {
  user: null as { id: string; email?: string } | null,
  plan: { cohort: COHORT as string | null, cohort_expires_at: null as string | null },
  rpcOutcome: 'created' as string,
  rpcCalls: [] as Array<Record<string, unknown>>,
  planReads: [] as string[],
  listReads: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  emails: [] as unknown[],
};

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        state.audits.push(entry);
      },
      flush: async () => undefined,
    }),
  },
}));

jest.mock('@/lib/business-os/invites/friendInviteDeps', () => ({
  friendInviteRepositories: {
    plans: {
      findEntitlementInputs: async (accountId: string) => {
        state.planReads.push(accountId);
        return { data: { plan: state.plan }, error: null };
      },
    },
    repository: {
      createForIssuerAccount: async (input: Record<string, unknown>) => {
        state.rpcCalls.push(input);
        return state.rpcOutcome === 'created'
          ? { data: { outcome: 'created', inviteId: INVITE_ID, linkExpiresAt: '2026-11-09T12:00:00.000Z' }, error: null }
          : { data: { outcome: state.rpcOutcome }, error: null };
      },
      listForIssuerAccount: async (accountId: string) => {
        state.listReads.push(accountId);
        return {
          data: [
            {
              id: INVITE_ID,
              email: 'friend@example.com',
              created_at: '2026-10-01T00:00:00.000Z',
              link_expires_at: '2099-10-31T00:00:00.000Z',
              revoked_at: null,
              redeemed_at: null,
              claimed_account_id: null,
            },
          ],
          error: null,
        };
      },
      recordInviteEmailOutcome: async () => ({ data: true, error: null }),
    },
    preferences: { findPreferredLanguage: async () => ({ data: 'he', error: null }) },
    profileRepository: { findById: async () => ({ data: { id: CHAMPION, full_name: 'Dana Champion' }, error: null }) },
    listLimit: 200,
  },
  friendInviteConfig: () => jest.requireActual('@/lib/business-os/entitlements/source').getEntitlementConfig(),
  friendInviteEmailDeps: (logger: unknown) => ({
    sendEmail: async (params: unknown) => {
      state.emails.push(params);
      return { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
    },
    senderAddress: () => 'invites@agentspilot.ai',
    now: () => new Date(),
    logger,
  }),
}));

import { GET, POST } from '@/app/api/business-os/friend-invites/route';

function post(body: unknown) {
  return new NextRequest('https://example.test/api/business-os/friend-invites', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const GOOD = { email: 'friend@example.com', language: 'en', personalNote: 'Come and see' };

beforeEach(() => {
  state.user = { id: CHAMPION, email: 'dana@example.com' };
  state.plan = { cohort: COHORT, cohort_expires_at: null };
  state.rpcOutcome = 'created';
  state.rpcCalls = [];
  state.planReads = [];
  state.listReads = [];
  state.audits = [];
  state.emails = [];
  policy.accountInvitesAvailable = true;
});

afterAll(() => {
  policy.accountInvitesAvailable = shippedSwitch;
});

describe('GET', () => {
  it('401 without a session, no-store, and nothing read', async () => {
    state.user = null;
    const response = await GET(new NextRequest('https://example.test/api/business-os/friend-invites'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.planReads).toEqual([]);
  });

  it('an eligible champion: the allowance, what is left and the list, for the SESSION account only', async () => {
    const response = await GET(new NextRequest(`https://example.test/api/business-os/friend-invites?accountId=${INVITE_ID}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.data).toMatchObject({ eligible: true, remaining: body.data.allowance - 1, defaultLanguage: 'he' });
    expect(Object.keys(body.data.invites[0]).sort()).toEqual(['createdAt', 'email', 'id', 'linkExpiresAt', 'slotReturned', 'status']);
    expect(state.planReads).toEqual([CHAMPION]);
    expect(state.listReads).toEqual([CHAMPION]);
  });

  it.each([
    ['a trial account', { cohort: 'trial', cohort_expires_at: null }],
    ['an Essentials account', { cohort: null, cohort_expires_at: null }],
    ['an expired champion', { cohort: COHORT, cohort_expires_at: '2020-01-01T00:00:00.000Z' }],
  ])('%s: 200 { eligible: false }, with no reason given', async (_label, plan) => {
    state.plan = plan as typeof state.plan;
    const body = await (await GET(new NextRequest('https://example.test/api/business-os/friend-invites'))).json();
    expect(body).toEqual({ success: true, data: { eligible: false } });
    expect(state.listReads).toEqual([]);
  });

  it('the switch off: { eligible: false } and no database read', async () => {
    policy.accountInvitesAvailable = false;
    const body = await (await GET(new NextRequest('https://example.test/api/business-os/friend-invites'))).json();
    expect(body).toEqual({ success: true, data: { eligible: false } });
    expect(state.planReads).toEqual([]);
  });

  it('the handler never reads the query string (source guard, the my-plan precedent)', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'api', 'business-os', 'friend-invites', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/searchParams/);
  });
});

describe('POST', () => {
  it('happy path: 201 with the link once, no-store, audited without the email or the link', async () => {
    const response = await POST(post(GOOD));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body.data.link).toMatch(/\/invite#t=[A-Za-z0-9_-]{43}$/);
    expect(body.data.invite).toMatchObject({ id: INVITE_ID, status: 'pending' });
    expect(body.data.email).toEqual({ status: 'sent' });
    expect(state.rpcCalls[0]).toMatchObject({ issuerAccountId: CHAMPION, email: 'friend@example.com' });

    const actions = state.audits.map((entry) => entry.action);
    expect(actions).toEqual(['BOS_FRIEND_INVITE_CREATED', 'BOS_INVITE_EMAIL_SENT']);
    for (const entry of state.audits) {
      expect(entry.userId).toBe(CHAMPION);
      expect(entry.actorId).toBe(CHAMPION);
    }
    const audited = JSON.stringify(state.audits.map((entry) => entry.details));
    expect(audited).not.toContain('friend@example.com');
    expect(audited).not.toContain('Come and see');
    expect(audited).not.toContain(body.data.link.split('#t=')[1]);
  });

  it('401 without a session, and nothing parsed or written', async () => {
    state.user = null;
    const response = await POST(post(GOOD));
    expect(response.status).toBe(401);
    expect(state.rpcCalls).toEqual([]);
  });

  it.each([
    ['a bad email', { ...GOOD, email: 'not-an-email' }],
    ['a note over 1,000 characters', { ...GOOD, personalNote: 'x'.repeat(1001) }],
    ['an unknown language', { ...GOOD, language: 'fr' }],
    ['no language', { email: GOOD.email }],
    ['an injected grantId', { ...GOOD, grantId: 'tier-x' }],
    ['an injected inviteType', { ...GOOD, inviteType: 'champion' }],
    ['an injected issuerAccountId', { ...GOOD, issuerAccountId: INVITE_ID }],
    ['an injected linkExpiryDays', { ...GOOD, linkExpiryDays: 60 }],
    ['an injected level', { ...GOOD, level: 1 }],
    ['an injected accountId', { ...GOOD, accountId: INVITE_ID }],
    ['a body that is not JSON', 'not json'],
  ])('400 for %s, and NOTHING is read or written (AC-16, R-3)', async (_label, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.planReads).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });

  it.each([
    ['a trial account', { cohort: 'trial', cohort_expires_at: null }],
    ['an Essentials account', { cohort: null, cohort_expires_at: null }],
    ['an expired champion', { cohort: COHORT, cohort_expires_at: '2020-01-01T00:00:00.000Z' }],
  ])('403 for %s, with the switch ON: NOT audited (N-4, Slice 5b D-12), and no SQL call', async (_label, plan) => {
    state.plan = plan as typeof state.plan;
    const response = await POST(post(GOOD));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('not_eligible');
    expect(state.rpcCalls).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('N-4: a not_eligible from the SQL side (a champion lapsing mid-request) is not audited either', async () => {
    state.rpcOutcome = 'not_eligible';
    const response = await POST(post(GOOD));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('not_eligible');
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.audits).toEqual([]);
  });

  it('N-4: the other four refusals are still audited, by class only', async () => {
    const reasons: string[] = [];
    await POST(post({ ...GOOD, email: 'DANA@example.com' }));
    for (const outcome of ['allowance_reached', 'daily_limit', 'already_invited']) {
      state.rpcOutcome = outcome;
      await POST(post(GOOD));
    }
    for (const entry of state.audits) {
      expect(entry.action).toBe('BOS_FRIEND_INVITE_REFUSED');
      reasons.push(String((entry.details as Record<string, unknown>).reason));
    }
    expect(reasons).toEqual(['own_email', 'allowance_reached', 'daily_limit', 'already_invited']);
  });

  it('403 with the switch off, and NOT audited (only a hand-made POST reaches it)', async () => {
    policy.accountInvitesAvailable = false;
    const response = await POST(post(GOOD));
    expect(response.status).toBe(403);
    expect(state.planReads).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('409 own_email for the champion\'s own address', async () => {
    const response = await POST(post({ ...GOOD, email: 'DANA@example.com' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('own_email');
    expect(state.rpcCalls).toEqual([]);
  });

  it('the allowance and the daily limit are distinct: 409 and 429, each with its own message', async () => {
    state.rpcOutcome = 'allowance_reached';
    const allowance = await POST(post(GOOD));
    const allowanceBody = await allowance.json();
    state.rpcOutcome = 'daily_limit';
    const daily = await POST(post(GOOD));
    const dailyBody = await daily.json();
    state.rpcOutcome = 'already_invited';
    const duplicate = await POST(post(GOOD));
    const duplicateBody = await duplicate.json();

    expect([allowance.status, daily.status, duplicate.status]).toEqual([409, 429, 409]);
    expect([allowanceBody.error, dailyBody.error, duplicateBody.error]).toEqual(['allowance_reached', 'daily_limit', 'already_invited']);
    expect(new Set([allowanceBody.message, dailyBody.message, duplicateBody.message]).size).toBe(3);
    expect(dailyBody.message).not.toMatch(/\d/);
    expect(state.emails).toEqual([]);
  });
});
