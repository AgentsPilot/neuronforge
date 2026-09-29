/**
 * GET and POST /api/admin/business-os/invites — the gate, the shapes, the
 * token-leak rules (C-3), Paid refused (C-6), the one list-view mapper (R-7) and
 * the audit flushed before the response (R-1). Slice 2a: the invitation email
 * on create (sent / not sent / sender not configured / unknown), the admin as
 * the actor of both audit entries (SA R-8), `maxDuration`, and the form's
 * language default from the admin's preference (D-8).
 *
 * Tier ids come from `TIER_ORDER`; this file names none.
 */

import { createHash } from 'crypto';
import { NextRequest } from 'next/server';

import type { BusinessOsInvite, CreateBusinessOsInviteInput } from '@/lib/repositories/types';

const ADMIN = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';

const state = {
  user: null as { id: string; email?: string } | null,
  isAdmin: false,
  adminThrows: false,
  /** A self-promoted profile: must still be refused (AC-6). */
  profileRole: 'user' as string,
  profileName: 'Dana Levi' as string | null,
  rows: [] as BusinessOsInvite[],
  listError: false,
  listCalls: 0,
  createError: false,
  inserted: [] as CreateBusinessOsInviteInput[],
  audit: [] as Array<Record<string, unknown>>,
  flushRejects: false,
  events: [] as string[],
  logs: [] as unknown[],
  // Slice 2a
  senderAddress: 'team@agentpilot.example' as string | undefined,
  sendResult: { sent: true, provider: 'resend', providerMessageId: 'msg_1' } as Record<string, unknown>,
  sendHangs: false,
  sent: [] as Array<Record<string, unknown>>,
  outcomes: [] as Array<Record<string, unknown>>,
  outcomeRecorded: true,
  preference: { data: null, error: null } as { data: string | null; error: Error | null },
};

jest.mock('@/lib/notifications/emailTransport', () => ({
  platformSenderAddress: () => state.senderAddress,
  sendEmail: async (params: Record<string, unknown>) => {
    state.events.push('send');
    state.sent.push(params);
    if (state.sendHangs) return new Promise(() => undefined);
    return state.sendResult;
  },
}));

jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async () => state.preference,
  },
}));

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({
      isAdmin: async () => {
        if (state.adminThrows) throw new Error('admin lookup exploded');
        return state.isAdmin;
      },
    }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        state.audit.push(entry);
        state.events.push('log');
      },
      flush: async () => {
        state.events.push('flush');
        if (state.flushRejects) throw new Error('flush failed');
      },
    }),
  },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => state.logs.push(args);
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    findById: async () => ({ data: { id: ADMIN, full_name: state.profileName, role: state.profileRole }, error: null }),
  },
}));

const lineageCalls: string[][] = [];
jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: {
    findByInviteIdsForAdmin: async (ids: string[]) => {
      lineageCalls.push(ids);
      return { data: ids.map((id) => ({ account_id: 'acct-1', invite_id: id, level: 1 })), error: null };
    },
  },
}));

jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    listRecentForAdmin: async () => {
      state.listCalls += 1;
      return state.listError
        ? { data: null, error: new Error('relation does not exist') }
        : { data: state.rows, error: null };
    },
    createForAdmin: async (input: CreateBusinessOsInviteInput) => {
      state.events.push('insert');
      state.inserted.push(input);
      if (state.createError) return { data: null, error: new Error('insert failed') };
      return {
        data: {
          id: INVITE_ID,
          ...input,
          email_locked: true,
          issuer_kind: 'admin',
          issuer_account_id: null,
          first_viewed_at: null,
          revoked_at: null,
          revoked_by_admin_id: null,
          revoke_reason: null,
          redeemed_at: null,
          redeemed_account_id: null,
          opened_by_existing_account_at: null,
          claimed_at: null,
          claimed_account_id: null,
          redemption_failed_at: null,
          redemption_failed_step: null,
          redemption_error_code: null,
          redemption_error_message: null,
          redemption_failed_account_id: null,
          email_sent_at: null,
          email_provider_message_id: null,
          email_problem: null,
          email_problem_at: null,
          created_at: '2026-10-01T12:00:00.000Z',
          updated_at: '2026-10-01T12:00:00.000Z',
        },
        error: null,
      };
    },
    recordInviteEmailOutcome: async (input: Record<string, unknown>) => {
      state.events.push('record');
      state.outcomes.push(input);
      return { data: state.outcomeRecorded, error: null };
    },
  },
}));

import { CHAMPION_INVITE_TYPE, INVITE_TYPES, PAID_INVITE_TYPE } from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { INVITE_LIST_VIEW_KEYS } from '@/lib/business-os/invites/adminInviteOps';
import { INVITE_EMAIL_POLICY } from '@/lib/business-os/invites/inviteEmailPolicy';
import { platformUrl } from '@/lib/utils/origins';

import { GET, POST, maxDuration } from '../route';

const URL_BASE = 'http://localhost:3000/api/admin/business-os/invites';

function post(body: unknown): NextRequest {
  return new NextRequest(URL_BASE, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
  });
}

function championBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inviteType: CHAMPION_INVITE_TYPE,
    email: 'X@Example.com',
    access: { kind: 'open_ended' },
    linkExpiryDays: 30,
    language: 'en',
    personalNote: 'Welcome aboard, would love your feedback',
    reason: 'QA slice 0 demo',
    sendEmail: false,
    ...overrides,
  };
}

function storedRow(overrides: Partial<BusinessOsInvite> = {}): BusinessOsInvite {
  return {
    id: INVITE_ID,
    email: 'x@example.com',
    email_locked: true,
    invite_type: CHAMPION_INVITE_TYPE,
    grant_kind: 'cohort',
    grant_id: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId,
    access_open_ended: true,
    access_months: null,
    issuer_kind: 'admin',
    issuer_admin_id: ADMIN,
    issuer_account_id: null,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: null,
    internal_reason: 'Secret internal reason',
    link_expiry_days: 30,
    link_expires_at: '2099-01-01T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    revoked_by_admin_id: null,
    revoke_reason: null,
    redeemed_at: null,
    redeemed_account_id: null,
    opened_by_existing_account_at: null,
    claimed_at: null,
    claimed_account_id: null,
    redemption_failed_at: null,
    redemption_failed_step: null,
    redemption_error_code: null,
    redemption_error_message: null,
    redemption_failed_account_id: null,
    email_attempted_at: null,
    email_sent_at: null,
    email_provider_message_id: null,
    email_problem: null,
    email_problem_at: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  state.user = { id: ADMIN, email: 'admin@example.com' };
  state.isAdmin = true;
  state.adminThrows = false;
  state.profileRole = 'user';
  state.profileName = 'Dana Levi';
  state.rows = [];
  state.listError = false;
  state.listCalls = 0;
  state.createError = false;
  state.inserted = [];
  state.audit = [];
  state.flushRejects = false;
  state.events = [];
  state.logs = [];
  state.senderAddress = 'team@agentpilot.example';
  state.sendResult = { sent: true, provider: 'resend', providerMessageId: 'msg_1' };
  state.sent = [];
  state.outcomes = [];
  state.outcomeRecorded = true;
  state.sendHangs = false;
  state.preference = { data: null, error: null };
});

describe('the gate (both handlers)', () => {
  it.each([
    ['GET', () => GET(new NextRequest(URL_BASE))],
    ['POST', () => POST(post(championBody()))],
  ])('%s: 401 signed out', async (_method, call) => {
    state.user = null;
    expect((await call()).status).toBe(401);
    // QA-1: the gate runs before any read.
    expect(state.listCalls).toBe(0);
    expect(state.inserted).toHaveLength(0);
  });

  it.each([
    ['GET', () => GET(new NextRequest(URL_BASE))],
    ['POST', () => POST(post(championBody()))],
  ])('%s: 403 signed in, not an admin', async (_method, call) => {
    state.isAdmin = false;
    expect((await call()).status).toBe(403);
    expect(state.listCalls).toBe(0);
    expect(state.inserted).toHaveLength(0);
  });

  it('403 when profiles.role says admin but admin_users does not (AC-6)', async () => {
    state.isAdmin = false;
    state.profileRole = 'admin';
    expect((await GET(new NextRequest(URL_BASE))).status).toBe(403);
    expect((await POST(post(championBody()))).status).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });

  it('403 when the admin check throws (fail closed)', async () => {
    state.adminThrows = true;
    expect((await GET(new NextRequest(URL_BASE))).status).toBe(403);
  });

  it('POST: the body is never read before the gate, by any reader', async () => {
    for (const setup of [() => (state.user = null), () => (state.isAdmin = false)]) {
      setup();
      const request = post(championBody());
      // QA-2: every way to reach the body, not only `json()`.
      const readers = (['json', 'text', 'formData', 'arrayBuffer', 'blob', 'clone'] as const).map((method) =>
        jest.spyOn(request, method)
      );
      const bodyGetter = jest.spyOn(request, 'body', 'get');
      const response = await POST(request);
      expect([401, 403]).toContain(response.status);
      for (const reader of readers) expect(reader).not.toHaveBeenCalled();
      expect(bodyGetter).not.toHaveBeenCalled();
      expect(state.inserted).toHaveLength(0);
      state.user = { id: ADMIN };
      state.isAdmin = true;
    }
  });
});

describe('GET', () => {
  it('200: rows mapped by the list view (no hash, no issuer, no reason), form options from config', async () => {
    state.rows = [storedRow()];
    const response = await GET(new NextRequest(URL_BASE));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data.invites).toHaveLength(1);
    const [invite] = body.data.invites;
    expect(Object.keys(invite).sort()).toEqual([...INVITE_LIST_VIEW_KEYS].sort());
    expect(invite.state).toBe('pending');
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('token_hash');
    expect(serialised).not.toContain('Secret internal reason');
    expect(serialised).not.toContain(ADMIN);

    expect(body.data.formOptions.expiryDays).toEqual([15, 30, 60]);
    expect(body.data.formOptions.defaultExpiryDays).toBe(30);
    expect(body.data.formOptions.defaultLanguage).toBe('en');
    const paid = body.data.formOptions.inviteTypes.find((type: { type: string }) => type.type === PAID_INVITE_TYPE);
    expect(paid.available).toBe(false);
    expect(paid.unavailableReason).toBe('available when payments are live');
    expect(['off', 'shadow', 'enforce']).toContain(body.data.enforcementMode);
  });

  it('Slice 1b: an accepted row carries its account and L1 (lineage read only for accepted rows); the T-16 summary is present', async () => {
    lineageCalls.length = 0;
    state.rows = [
      storedRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', redeemed_at: '2026-10-02T00:00:00.000Z', redeemed_account_id: 'acct-1', claimed_at: '2026-10-02T00:00:00.000Z', claimed_account_id: 'acct-1' }),
      // A claim long past the lease (the route reads the real clock).
      storedRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', claimed_at: '2020-01-01T00:00:00.000Z', claimed_account_id: 'acct-2' }),
    ];
    const body = await (await GET(new NextRequest(URL_BASE))).json();
    const [accepted, stopped] = body.data.invites;
    expect(accepted).toMatchObject({ state: 'accepted', redeemedAccountId: 'acct-1', level: 1, redemptionStoppedHalfway: false });
    expect(stopped).toMatchObject({ redemptionStoppedHalfway: true, redemptionFailure: null });
    expect(lineageCalls).toEqual([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']]);
    expect(body.data.stoppedHalfway).toEqual({ count: 1, inviteIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] });
  });

  it('Slice 1c: reports `truncated` (false below the ceiling)', async () => {
    state.rows = [storedRow()];
    const body = await (await GET(new NextRequest(URL_BASE))).json();
    expect(body.data.truncated).toBe(false);
  });

  it('Slice 1c: reports `truncated` when the 500 ceiling is reached', async () => {
    state.rows = Array.from({ length: 500 }, () => storedRow());
    const body = await (await GET(new NextRequest(URL_BASE))).json();
    expect(body.data.invites).toHaveLength(500);
    expect(body.data.truncated).toBe(true);
  });

  it('Slice 1c: filters run on the screen, so a query string changes nothing and is never logged', async () => {
    state.rows = [storedRow()];
    const plain = await (await GET(new NextRequest(URL_BASE))).json();
    const withQuery = await (await GET(new NextRequest(`${URL_BASE}?q=secret-needle&state=revoked`))).json();
    expect(withQuery).toEqual(plain);
    expect(JSON.stringify(state.logs)).not.toContain('secret-needle');
  });

  it('Slice 1c: a query string does not get past the gate', async () => {
    state.isAdmin = false;
    expect((await GET(new NextRequest(`${URL_BASE}?q=x&state=pending`))).status).toBe(403);
    state.isAdmin = true;
    state.user = null;
    expect((await GET(new NextRequest(`${URL_BASE}?q=x`))).status).toBe(401);
    expect(state.listCalls).toBe(0);
  });

  it('500 on a repository error', async () => {
    state.listError = true;
    const response = await GET(new NextRequest(URL_BASE));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('could_not_read_invites');
  });
});

describe('POST: invalid input is 400, and nothing is written', () => {
  it.each([
    ['not JSON', '{nope'],
    ['a bad email', championBody({ email: 'nope' })],
    ['a missing reason', championBody({ reason: undefined })],
    ['a 2-character reason', championBody({ reason: 'ab' })],
    ['champion without access', championBody({ access: undefined })],
    ['linkExpiryDays 45', championBody({ linkExpiryDays: 45 })],
    ['an unknown language', championBody({ language: 'fr' })],
    ['a missing sendEmail (Slice 2a)', championBody({ sendEmail: undefined })],
    ['a string sendEmail (Slice 2a)', championBody({ sendEmail: 'true' })],
  ])('%s', async (_label, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_input');
    expect(state.inserted).toHaveLength(0);
  });

  it.each(['grant_id', 'grantKind', 'issuerAdminId', 'issuer', 'userId', 'tokenHash', 'cohort', 'level', 'from', 'replyTo', 'inviterReplyTo'])(
    'an injected %s is refused by .strict()',
    async (key) => {
      const response = await POST(post(championBody({ [key]: 'x' })));
      expect(response.status).toBe(400);
      expect(state.inserted).toHaveLength(0);
    }
  );
});

describe('POST: Paid is refused on the server (C-6)', () => {
  it('409 paid_invites_not_available, and the repository is never called', async () => {
    const response = await POST(
      post({
        inviteType: PAID_INVITE_TYPE,
        email: 'lee@example.com',
        grantId: TIER_ORDER[0],
        linkExpiryDays: 30,
        language: 'en',
        reason: 'Referred',
        sendEmail: true,
      })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('paid_invites_not_available');
    expect(state.inserted).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
    expect(state.sent).toHaveLength(0);
  });
});

describe('POST: the happy path', () => {
  it('201 with the link once, no-store, the hash stored, a frozen-clock expiry, the profile name, and an audit with no token', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const response = await POST(post(championBody()));
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');

      const body = await response.json();
      const prefix = `${platformUrl('/invite')}#t=`;
      expect(body.data.link.startsWith(prefix)).toBe(true);
      const token: string = body.data.link.slice(prefix.length);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const [row] = state.inserted;
      const hash = createHash('sha256').update(token).digest('hex');
      expect(row.token_hash).toBe(hash);
      expect(row.token_hash).not.toBe(token);
      expect(row.link_expires_at).toBe('2026-10-31T12:00:00.000Z');
      expect(row.inviter_display_name).toBe('Dana Levi');
      expect(row.email).toBe('x@example.com');

      // R-7: the invite is the list-row shape, and nothing else.
      expect(Object.keys(body.data.invite).sort()).toEqual([...INVITE_LIST_VIEW_KEYS].sort());
      for (const key of ['token_hash', 'tokenHash', 'issuer_admin_id', 'internal_reason', 'redeemed_account_id']) {
        expect(body.data.invite).not.toHaveProperty(key);
      }
      expect(JSON.stringify(body.data.invite)).not.toContain(token);

      // The audit: the right action, the correlation id, and neither the token nor its hash.
      expect(state.audit).toHaveLength(1);
      expect(state.audit[0].action).toBe('BOS_INVITE_CREATED');
      expect(state.audit[0].entityType).toBe('business_os_invite');
      expect(state.audit[0].entityId).toBe(INVITE_ID);
      expect((state.audit[0].details as Record<string, unknown>).correlationId).toBe('corr-1');
      const auditText = JSON.stringify(state.audit);
      expect(auditText).not.toContain(token);
      expect(auditText).not.toContain(hash);
      expect(auditText).not.toContain('x@example.com');

      // …and no log line carries either.
      const logText = JSON.stringify(state.logs);
      expect(logText).not.toContain(token);
      expect(logText).not.toContain(hash);
    } finally {
      jest.useRealTimers();
    }
  });

  it('R-1: the audit is logged, then flushed, before the response', async () => {
    const response = await POST(post(championBody()));
    expect(response.status).toBe(201);
    expect(state.events).toEqual(['insert', 'log', 'flush']);
  });

  it('R-1: a rejected flush still returns 201', async () => {
    state.flushRejects = true;
    const response = await POST(post(championBody()));
    expect(response.status).toBe(201);
    expect(state.events).toContain('flush');
  });

  it('500 could_not_create_invite on a repository error, with no audit', async () => {
    state.createError = true;
    const response = await POST(post(championBody()));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('could_not_create_invite');
    expect(state.audit).toHaveLength(0);
  });
});

describe('Slice 2a: the invitation email on create', () => {
  const INVITEE = 'x@example.com';

  function tokenOf(link: string): string {
    return link.slice(`${platformUrl('/invite')}#t=`.length);
  }

  it('maxDuration is 30 (D-5: the send is inline)', () => {
    expect(maxDuration).toBe(30);
  });

  it('QA2a-1: the send limit sits well below maxDuration (at least 5 s left to answer)', () => {
    expect(INVITE_EMAIL_POLICY.sendTimeoutMs).toBeLessThanOrEqual(maxDuration * 1000 - 5000);
  });

  it('QA2a-1: a provider that never answers → 201 with the link, email unknown, NOT_SENT send_timeout, nothing recorded', async () => {
    state.sendHangs = true;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      const pending = POST(post(championBody({ sendEmail: true })));
      await jest.advanceTimersByTimeAsync(INVITE_EMAIL_POLICY.sendTimeoutMs);
      const response = await pending;
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.link).toMatch(/#t=/);
      expect(body.data.email).toEqual({ requested: true, status: 'unknown' });
      expect(body.data.invite.emailStatus).toBe('unknown');
      expect(state.outcomes).toHaveLength(0);
      expect(state.audit.map((entry) => entry.action)).toEqual(['BOS_INVITE_CREATED', 'BOS_INVITE_EMAIL_NOT_SENT']);
      expect(state.audit[1]).toMatchObject({ userId: ADMIN, actorId: ADMIN, details: { correlationId: 'corr-1', reason: 'send_timeout' } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sendEmail true, sent: 201 with the link AND email sent; insert, send, record, then the two audits, then flush', async () => {
    const response = await POST(post(championBody({ sendEmail: true })));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();

    expect(body.data.email).toEqual({ requested: true, status: 'sent' });
    expect(body.data.link).toMatch(/#t=/);
    expect(body.data.invite.emailStatus).toBe('sent');
    expect(state.events).toEqual(['insert', 'send', 'record', 'log', 'log', 'flush']);
    expect(state.sent[0].html).toEqual(expect.stringContaining(body.data.link));
    expect(state.sent[0].replyTo).toBe('admin@example.com');
    expect(state.sent[0]).not.toHaveProperty('ownerUserId');
    expect(state.inserted[0].inviter_reply_to).toBe('admin@example.com');
    expect(state.inserted[0].email_attempted_at).toEqual(expect.any(String));
  });

  it('R-8: CREATED then EMAIL_SENT, both with the admin as userId and actorId; details carry provider and message id only', async () => {
    await POST(post(championBody({ sendEmail: true })));
    expect(state.audit.map((entry) => entry.action)).toEqual(['BOS_INVITE_CREATED', 'BOS_INVITE_EMAIL_SENT']);
    for (const entry of state.audit) {
      expect(entry.userId).toBe(ADMIN);
      expect(entry.actorId).toBe(ADMIN);
      expect(entry.entityId).toBe(INVITE_ID);
    }
    expect(state.audit[1].details).toEqual({ correlationId: 'corr-1', provider: 'resend', providerMessageId: 'msg_1' });
    expect((state.audit[0].details as Record<string, unknown>).emailRequested).toBe(true);
  });

  it('sender not configured (R-2): 201, link shown, not_sent, nothing sent, EMAIL_NOT_SENT with the reason', async () => {
    state.senderAddress = undefined;
    const response = await POST(post(championBody({ sendEmail: true })));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.email).toEqual({ requested: true, status: 'not_sent' });
    expect(body.data.link).toMatch(/#t=/);
    expect(state.sent).toHaveLength(0);
    expect(state.audit.map((entry) => entry.action)).toEqual(['BOS_INVITE_CREATED', 'BOS_INVITE_EMAIL_NOT_SENT']);
    expect(state.audit[1]).toMatchObject({ userId: ADMIN, actorId: ADMIN, details: { correlationId: 'corr-1', reason: 'sender_not_configured' } });
  });

  it('transport failure (FR-16): 201 with the link, not_sent, EMAIL_NOT_SENT transport_failed, no error text anywhere in the response', async () => {
    state.sendResult = { sent: false, provider: 'none', error: `resend: rejected ${INVITEE}` };
    const response = await POST(post(championBody({ sendEmail: true })));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.email).toEqual({ requested: true, status: 'not_sent' });
    expect(state.audit[1]).toMatchObject({ action: 'BOS_INVITE_EMAIL_NOT_SENT', details: { correlationId: 'corr-1', reason: 'transport_failed' } });
    expect(JSON.stringify(body)).not.toContain('rejected');
  });

  it('the outcome could not be recorded: 201, the email still reports sent, the row shows unknown', async () => {
    state.outcomeRecorded = false;
    const body = await (await POST(post(championBody({ sendEmail: true })))).json();
    expect(body.data.email).toEqual({ requested: true, status: 'sent' });
    expect(body.data.invite.emailStatus).toBe('unknown');
  });

  it('SMTP / Gmail: sent_untracked, and the audit has no message id', async () => {
    state.sendResult = { sent: true, provider: 'gmail' };
    const body = await (await POST(post(championBody({ sendEmail: true })))).json();
    expect(body.data.email).toEqual({ requested: true, status: 'sent_untracked' });
    expect(state.audit[1].details).toEqual({ correlationId: 'corr-1', provider: 'gmail' });
  });

  it('sendEmail false: nothing sent, one audit, email not_emailed', async () => {
    const body = await (await POST(post(championBody({ sendEmail: false })))).json();
    expect(body.data.email).toEqual({ requested: false, status: 'not_emailed' });
    expect(state.sent).toHaveLength(0);
    expect(state.audit.map((entry) => entry.action)).toEqual(['BOS_INVITE_CREATED']);
    expect(state.inserted[0].email_attempted_at).toBeNull();
  });

  it('a rejected flush still answers 201 with the link and the email status', async () => {
    state.flushRejects = true;
    const response = await POST(post(championBody({ sendEmail: true })));
    expect(response.status).toBe(201);
    expect((await response.json()).data.email.status).toBe('sent');
  });

  it('the gate has no email: the invite has no Reply-To snapshot, and the send has no replyTo', async () => {
    state.user = { id: ADMIN };
    await POST(post(championBody({ sendEmail: true })));
    expect(state.inserted[0].inviter_reply_to).toBeNull();
    expect(state.sent[0]).not.toHaveProperty('replyTo');
  });

  it.each([
    ['sent', { sent: true, provider: 'resend', providerMessageId: 'msg_1' }],
    ['not sent', { sent: false, provider: 'none', error: 'resend: 422' }],
  ])('LEAK (%s): no audit entry and no log line holds the token, the link, the hash or the invitee email', async (_label, result) => {
    state.sendResult = result;
    const body = await (await POST(post(championBody({ sendEmail: true })))).json();
    const token = tokenOf(body.data.link);
    const hash = createHash('sha256').update(token).digest('hex');
    const text = JSON.stringify(state.audit) + JSON.stringify(state.logs);
    for (const secret of [token, body.data.link, hash, INVITEE, 'admin@example.com']) {
      expect(text).not.toContain(secret);
    }
    // The response's email block carries status words only.
    expect(Object.keys(body.data.email).sort()).toEqual(['requested', 'status']);
  });
});

describe('Slice 2a: GET pre-selects the admin language (D-8)', () => {
  it('the saved preference', async () => {
    state.preference = { data: 'he', error: null };
    const body = await (await GET(new NextRequest(URL_BASE))).json();
    expect(body.data.formOptions.defaultLanguage).toBe('he');
  });

  it('en when there is none, or on a read error (with a warning, still 200)', async () => {
    const none = await (await GET(new NextRequest(URL_BASE))).json();
    expect(none.data.formOptions.defaultLanguage).toBe('en');

    state.preference = { data: null, error: new Error('db') };
    const response = await GET(new NextRequest(URL_BASE));
    expect(response.status).toBe(200);
    expect((await response.json()).data.formOptions.defaultLanguage).toBe('en');
  });

  it('rows carry emailStatus and never the message id, the problem detail or the Reply-To', async () => {
    state.rows = [storedRow({ email_attempted_at: '2026-10-01T12:00:00.000Z', email_sent_at: '2026-10-01T12:00:02.000Z', email_provider_message_id: 'msg_hidden' })];
    const body = await (await GET(new NextRequest(URL_BASE))).json();
    expect(body.data.invites[0]).toMatchObject({ emailStatus: 'sent', emailStatusAt: '2026-10-01T12:00:02.000Z' });
    expect(JSON.stringify(body)).not.toContain('msg_hidden');
  });
});
