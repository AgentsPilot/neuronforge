/**
 * POST /api/public/invites/validate — AC-2 (one identical answer for every bad
 * token), the allow-list per state, the headers, R-6 (runtime and dynamic), and
 * no token or hash in any log line.
 *
 * Public by design: there is no 401 or 403 to test (SA ruling F-2). No auth
 * module is even mocked; the route must not import one.
 *
 * Slice 1a: the `existing_account` state (FR-8a, L-3), its once-only audit
 * entry flushed before the response, and "try again" (never "no account") when
 * the account lookup fails.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

import type { BusinessOsInvitePublicView } from '@/lib/repositories/types';

const state = {
  row: null as BusinessOsInvitePublicView | null,
  /** Which hash holds `row`. */
  matchHash: '',
  lookupError: false,
  lookups: 0,
  marks: [] as Array<{ id: string; now: Date }>,
  logs: [] as unknown[],
  inviteeEmail: 'invitee@example.com',
  hasAccount: false,
  accountError: false,
  accountQuestions: [] as string[],
  alreadyStamped: false,
  existingMarks: [] as string[],
  audit: [] as Array<Record<string, unknown>>,
  events: [] as string[],
  flushRejects: false,
};

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

jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    findByTokenHashForPublicView: async (hash: string) => {
      state.lookups += 1;
      if (state.lookupError) return { data: null, error: new Error('timeout') };
      return { data: hash === state.matchHash ? state.row : null, error: null };
    },
    markFirstViewed: async (id: string, now: Date) => {
      state.marks.push({ id, now });
      return { data: true, error: null };
    },
    findInviteeEmailForPublicCheck: async () => ({ data: state.inviteeEmail, error: null }),
    markOpenedByExistingAccount: async (id: string) => {
      state.existingMarks.push(id);
      return { data: !state.alreadyStamped, error: null };
    },
  },
}));

jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: {
    emailHasAccount: async (email: string) => {
      state.accountQuestions.push(email);
      if (state.accountError) return { data: null, error: new Error('lookup failed') };
      return { data: state.hasAccount, error: null };
    },
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

import { CHAMPION_INVITE_TYPE, INVITE_TYPES } from '@/lib/business-os/entitlements/config/invites';
import { generateInviteToken, hashInviteToken } from '@/lib/business-os/invites/inviteToken';

import * as routeModule from '../route';

const { POST } = routeModule;
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = generateInviteToken();
const HASH = hashInviteToken(TOKEN);

function stored(overrides: Partial<BusinessOsInvitePublicView> = {}): BusinessOsInvitePublicView {
  return {
    id: INVITE_ID,
    grant_kind: 'cohort',
    grant_id: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId,
    access_open_ended: true,
    access_months: null,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: 'Welcome aboard',
    link_expires_at: '2099-01-01T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    redeemed_at: null,
    ...overrides,
  };
}

function validate(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/public/invites/validate', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );
}

async function snapshot(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    cacheControl: response.headers.get('cache-control'),
    referrerPolicy: response.headers.get('referrer-policy'),
  };
}

beforeEach(() => {
  state.row = stored();
  state.matchHash = HASH;
  state.lookupError = false;
  state.lookups = 0;
  state.marks = [];
  state.logs = [];
  state.inviteeEmail = 'invitee@example.com';
  state.hasAccount = false;
  state.accountError = false;
  state.accountQuestions = [];
  state.alreadyStamped = false;
  state.existingMarks = [];
  state.audit = [];
  state.events = [];
  state.flushRejects = false;
});

describe('R-6: route declarations', () => {
  it('runs on Node and is never cached', () => {
    expect(routeModule.runtime).toBe('nodejs');
    expect(routeModule.dynamic).toBe('force-dynamic');
  });

  it('imports no auth module: the route is public by design', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'api', 'public', 'invites', 'validate', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/@\/lib\/auth|requireAdmin|getUser|supabaseServer/);
  });
});

describe('AC-2: identical responses for every bad token', () => {
  it('unknown, malformed and one-character-off tokens give identical status, body and headers', async () => {
    const oneOff = `${TOKEN.slice(0, -1)}${TOKEN.endsWith('A') ? 'B' : 'A'}`;
    const candidates = [generateInviteToken(), oneOff, 'abc', `${TOKEN}A`, `${TOKEN.slice(0, -1)}+`];
    const results = [];
    for (const token of candidates) results.push(await snapshot(await validate({ token })));

    expect(results[0]).toEqual({
      status: 200,
      body: JSON.stringify({ success: true, data: { state: 'not_recognised' } }),
      cacheControl: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    for (const result of results) expect(result).toEqual(results[0]);
  });
});

describe('matched states', () => {
  it('valid: the exact key set, no email, ids or hash; first view stamped', async () => {
    const response = await validate({ token: TOKEN });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(
      ['inviterDisplayName', 'language', 'linkExpiresAt', 'offer', 'personalNote', 'state'].sort()
    );
    expect(body.data.state).toBe('valid');
    const text = JSON.stringify(body);
    expect(text).not.toContain(INVITE_ID);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('@');
    expect(state.marks).toHaveLength(1);
  });

  it('valid, already seen: first_viewed_at is not touched again', async () => {
    state.row = stored({ first_viewed_at: '2026-10-02T00:00:00.000Z' });
    await validate({ token: TOKEN });
    expect(state.marks).toHaveLength(0);
  });

  it.each([
    ['expired', { link_expires_at: '2020-01-01T00:00:00.000Z' }],
    ['revoked', { revoked_at: '2026-10-02T00:00:00.000Z' }],
    ['used', { redeemed_at: '2026-10-02T00:00:00.000Z' }],
    ['unavailable', { grant_id: 'retired-cohort' }],
  ])('%s: only state, language and the inviter name; nothing stamped', async (expected, overrides) => {
    state.row = stored(overrides);
    const body = await (await validate({ token: TOKEN })).json();
    expect(body.data).toEqual({ state: expected, language: 'en', inviterDisplayName: 'Dana' });
    expect(state.marks).toHaveLength(0);
  });
});

describe('Slice 1a: the invited email already has an account (FR-8a)', () => {
  beforeEach(() => {
    state.hasAccount = true;
  });

  it('answers existing_account with only state, language and the inviter name; no email, id or hash', async () => {
    const response = await validate({ token: TOKEN });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await response.json();
    expect(body).toEqual({ success: true, data: { state: 'existing_account', language: 'en', inviterDisplayName: 'Dana' } });
    const text = JSON.stringify(body);
    expect(text).not.toContain('@');
    expect(text).not.toContain(INVITE_ID);
    expect(text).not.toContain(HASH);
    expect(state.marks).toHaveLength(0);
    expect(state.existingMarks).toEqual([INVITE_ID]);
  });

  it('asks the lookup only about the matched invite email, never about request data', async () => {
    await validate({ token: TOKEN });
    expect(state.accountQuestions).toEqual(['invitee@example.com']);
    await validate({ token: generateInviteToken() });
    expect(state.accountQuestions).toHaveLength(1);
  });

  it('audits the first open once, anonymously, with the invite id and no email, token or hash, then flushes', async () => {
    await validate({ token: TOKEN });
    expect(state.audit).toHaveLength(1);
    const entry = state.audit[0];
    expect(entry.action).toBe('BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT');
    expect(entry.entityType).toBe('business_os_invite');
    expect(entry.entityId).toBe(INVITE_ID);
    expect(entry.userId).toBeNull();
    expect(entry.actorId).toBeNull();
    const serialised = JSON.stringify({ ...entry, request: undefined });
    expect(serialised).not.toContain('invitee@example.com');
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(HASH);
    expect(state.events).toEqual(['log', 'flush']);
  });

  it('a reload after the stamp is set writes no second audit entry', async () => {
    state.alreadyStamped = true;
    const body = await (await validate({ token: TOKEN })).json();
    expect(body.data.state).toBe('existing_account');
    expect(state.audit).toHaveLength(0);
    expect(state.events).toEqual([]);
  });

  it('a rejected flush still answers 200', async () => {
    state.flushRejects = true;
    const response = await validate({ token: TOKEN });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe('existing_account');
  });

  it('a failed account lookup is 503 "try again", never "no account" and never valid', async () => {
    state.accountError = true;
    const response = await validate({ token: TOKEN });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('unavailable_try_again');
    expect(state.marks).toHaveLength(0);
    expect(state.audit).toHaveLength(0);
  });

  it('no email reaches any log line', async () => {
    await validate({ token: TOKEN });
    state.accountError = true;
    await validate({ token: TOKEN });
    expect(JSON.stringify(state.logs)).not.toContain('invitee@example.com');
  });
});

describe('failures', () => {
  it.each([
    ['not JSON', '{nope'],
    ['a non-object', '"abc"'],
    ['a missing token', {}],
    ['an extra key', { token: TOKEN, email: 'x@example.com' }],
  ])('400 invalid_request for %s, with the same headers and no lookup', async (_label, body) => {
    const response = await validate(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_request');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(state.lookups).toBe(0);
  });

  it('503 unavailable_try_again on a repository error', async () => {
    state.lookupError = true;
    const response = await validate({ token: TOKEN });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('unavailable_try_again');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('T-7: no token and no hash in any log line', () => {
  it('across a valid check, a bad check and a failed lookup', async () => {
    await validate({ token: TOKEN });
    await validate({ token: `${TOKEN.slice(0, -1)}+` });
    state.lookupError = true;
    await validate({ token: TOKEN });
    const logText = JSON.stringify(state.logs);
    expect(state.logs.length).toBeGreaterThan(0);
    expect(logText).not.toContain(TOKEN);
    expect(logText).not.toContain(TOKEN.slice(0, 20));
    expect(logText).not.toContain(HASH);
  });

  it('the invite id is logged only on a match', async () => {
    await validate({ token: generateInviteToken() });
    expect(JSON.stringify(state.logs)).not.toContain(INVITE_ID);
    await validate({ token: TOKEN });
    expect(JSON.stringify(state.logs)).toContain(INVITE_ID);
  });
});
