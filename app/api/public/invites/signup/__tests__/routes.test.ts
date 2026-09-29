/**
 * The public signup routes (Slice 1b; Slice 3b adds /google): body shape (`.strict()`, L-1, AC-6),
 * the signed-in refusal before any read (L-8), the identical not-recognised
 * answer (AC-2), the status mapping, the headers, the audit flush (WC-7), the
 * route declarations, and no secret in any log line.
 *
 * The flow itself is tested in `lib/business-os/invites/__tests__/inviteRedemption.test.ts`;
 * here it is replaced so each route's own job is visible.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

const state = {
  user: null as { id: string } | null,
  userThrows: false,
  requestOutcome: { ok: true, codeExpiresAt: 'E', resendAvailableAt: 'R' } as Record<string, unknown>,
  completeOutcome: { ok: true, email: 'invitee@example.com', accountId: 'acct', inviteId: 'inv' } as Record<string, unknown>,
  requestCalls: [] as unknown[],
  completeCalls: [] as unknown[],
  googleOutcome: { ok: true, accountId: 'acct', inviteId: 'inv' } as Record<string, unknown>,
  googleCalls: [] as unknown[],
  googleThrows: false,
  events: [] as string[],
  logs: [] as unknown[],
};

jest.mock('@/lib/auth', () => ({
  getUser: async () => {
    state.events.push('getUser');
    if (state.userThrows) throw new Error('auth down');
    return state.user;
  },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => state.logs.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/business-os/invites/inviteRedemption', () => ({
  requestSignupCode: async (token: string) => {
    state.events.push('requestSignupCode');
    state.requestCalls.push(token);
    return state.requestOutcome;
  },
  completeSignup: async (input: unknown) => {
    state.events.push('completeSignup');
    state.completeCalls.push(input);
    return state.completeOutcome;
  },
  completeGoogleSignup: async (input: unknown) => {
    state.events.push('completeGoogleSignup');
    state.googleCalls.push(input);
    if (state.googleThrows) throw new Error('boom');
    return state.googleOutcome;
  },
}));

jest.mock('@/lib/business-os/invites/redemptionDeps', () => {
  const actual = jest.requireActual('@/lib/business-os/invites/redemptionDeps');
  return {
    ...actual,
    buildRedemptionDeps: () => ({}),
    flushRedemptionAudit: async () => {
      state.events.push('flush');
    },
  };
});

jest.mock('server-only', () => ({}));

import * as codeRoute from '../code/route';
import * as completeRoute from '../complete/route';
import * as googleRoute from '../google/route';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const PASSWORD = 'correct horse battery';

function post(handler: (request: NextRequest) => Promise<Response>, url: string, body: unknown) {
  return handler(
    new NextRequest(`http://localhost:3000${url}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );
}
const code = (body: unknown) => post(codeRoute.POST, '/api/public/invites/signup/code', body);
const complete = (body: unknown) => post(completeRoute.POST, '/api/public/invites/signup/complete', body);
const validBody = { token: TOKEN, signupCode: '482913', password: PASSWORD };

beforeEach(() => {
  state.user = null;
  state.userThrows = false;
  state.requestOutcome = { ok: true, codeExpiresAt: 'E', resendAvailableAt: 'R' };
  state.completeOutcome = { ok: true, email: 'invitee@example.com', accountId: 'acct', inviteId: 'inv' };
  state.requestCalls = [];
  state.completeCalls = [];
  state.googleOutcome = { ok: true, accountId: 'acct', inviteId: 'inv' };
  state.googleCalls = [];
  state.googleThrows = false;
  state.events = [];
  state.logs = [];
});

function headersOf(response: Response) {
  return { cache: response.headers.get('cache-control'), referrer: response.headers.get('referrer-policy') };
}

describe('route declarations', () => {
  it('both run on Node and are never cached; complete declares maxDuration 60 (below the claim lease)', () => {
    expect(codeRoute.runtime).toBe('nodejs');
    expect(codeRoute.dynamic).toBe('force-dynamic');
    expect(completeRoute.runtime).toBe('nodejs');
    expect(completeRoute.dynamic).toBe('force-dynamic');
    expect(completeRoute.maxDuration).toBe(60);
    expect(googleRoute.runtime).toBe('nodejs');
    expect(googleRoute.dynamic).toBe('force-dynamic');
    expect(googleRoute.maxDuration).toBe(60);
  });

  it('neither route names a repository, the plan repository or a service-role client', () => {
    for (const file of ['code', 'complete', 'google']) {
      const source = readFileSync(join(process.cwd(), 'app', 'api', 'public', 'invites', 'signup', file, 'route.ts'), 'utf8');
      expect(source).not.toMatch(/Repository|supabaseServer|deleteUser/);
    }
  });
});

describe('POST /signup/code', () => {
  it('200 with the expiry and resend times; no-store and no-referrer', async () => {
    const response = await code({ token: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { codeExpiresAt: 'E', resendAvailableAt: 'R' } });
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
    expect(state.requestCalls).toEqual([TOKEN]);
  });

  it.each([
    ['not JSON', '{nope'],
    ['a missing token', {}],
    ['an extra key', { token: TOKEN, email: 'attacker@example.com' }],
  ])('400 invalid_request for %s, before anything else', async (_label, body) => {
    const response = await code(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'invalid_request' });
    expect(state.events).toEqual([]);
  });

  it('L-8: a signed-in visitor is refused 409 signed_in before the invite is read', async () => {
    state.user = { id: 'someone' };
    const response = await code({ token: TOKEN });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'signed_in' });
    expect(state.events).toEqual(['getUser']);
  });

  it('429 carries retryAfterSeconds', async () => {
    state.requestOutcome = { ok: false, kind: 'refused', status: 429, error: 'code_recently_sent', retryAfterSeconds: 42 };
    const response = await code({ token: TOKEN });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ success: false, error: 'code_recently_sent', retryAfterSeconds: 42 });
  });

  it('flushes the audit before answering (WC-7)', async () => {
    await code({ token: TOKEN });
    expect(state.events).toEqual(['getUser', 'requestSignupCode', 'flush']);
  });
});

describe('POST /signup/complete', () => {
  it('200 with the email (only here, after proof) and the landing page', async () => {
    const response = await complete(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { email: 'invitee@example.com', redirectTo: '/onboarding-chat' } });
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
    expect(state.completeCalls).toEqual([validBody]);
    expect(state.events).toEqual(['getUser', 'completeSignup', 'flush']);
  });

  it.each([
    ['email', { email: 'attacker@example.com' }],
    ['userId', { userId: 'x' }],
    ['accountId', { accountId: 'x' }],
    ['cohort', { cohort: 'x' }],
    ['tier', { tier: 'x' }],
    ['level', { level: 2 }],
  ])('L-1 / AC-6: an injected %s is a 400 and reaches nothing', async (_label, extra) => {
    const response = await complete({ ...validBody, ...extra });
    expect(response.status).toBe(400);
    expect(state.events).toEqual([]);
  });

  it.each([
    ['a 5-digit code', { signupCode: '48291' }],
    ['a non-digit code', { signupCode: '48291a' }],
    ['a 7-character password', { password: 'short12' }],
    ['a 73-byte ASCII password', { password: 'x'.repeat(73) }],
    // QA-1b-7: refused by the character cap before any byte count.
    ['a 100,000-character password', { password: 'x'.repeat(100_000) }],
    // R-13: 25 three-byte characters = 75 bytes, under 72 CHARACTERS but over 72 BYTES.
    ['a multi-byte password over 72 bytes', { password: '漢'.repeat(25) }],
  ])('400 for %s', async (_label, overrides) => {
    const response = await complete({ ...validBody, ...overrides });
    expect(response.status).toBe(400);
    expect(state.events).toEqual([]);
  });

  it('R-13: a multi-byte password of exactly 72 bytes is accepted', async () => {
    const response = await complete({ ...validBody, password: '漢'.repeat(24) });
    expect(response.status).toBe(200);
  });

  it('SA N-2: a failed session check is logged and treated as signed out', async () => {
    state.userThrows = true;
    expect((await complete(validBody)).status).toBe(200);
    expect((await code({ token: TOKEN })).status).toBe(200);
    expect(JSON.stringify(state.logs).match(/Session check failed/g)).toHaveLength(2);
  });

  it('L-8: signed in → 409 before the flow runs', async () => {
    state.user = { id: 'someone' };
    const response = await complete(validBody);
    expect(response.status).toBe(409);
    expect(state.events).toEqual(['getUser']);
  });

  it('AC-2: a token that did not match gets the byte-identical validate answer', async () => {
    state.completeOutcome = { ok: false, kind: 'not_recognised' };
    const response = await complete(validBody);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ success: true, data: { state: 'not_recognised' } }));
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
  });

  it.each([
    [{ ok: false, kind: 'refused', status: 409, error: 'code_invalid', attemptsRemaining: 3 }, 409, { success: false, error: 'code_invalid', attemptsRemaining: 3 }],
    [{ ok: false, kind: 'refused', status: 409, error: 'signup_in_progress' }, 409, { success: false, error: 'signup_in_progress' }],
    [{ ok: false, kind: 'refused', status: 400, error: 'weak_password' }, 400, { success: false, error: 'weak_password' }],
    [{ ok: false, kind: 'unavailable_try_again' }, 503, { success: false, error: 'unavailable_try_again' }],
  ])('maps %j to %i', async (outcome, status, body) => {
    state.completeOutcome = outcome;
    const response = await complete(validBody);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it('no token, code, password or email in any log line', async () => {
    await complete(validBody);
    state.completeOutcome = { ok: false, kind: 'refused', status: 409, error: 'code_invalid', attemptsRemaining: 1 };
    await complete(validBody);
    const text = JSON.stringify(state.logs);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('482913');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('invitee@example.com');
  });
});

describe('POST /signup/google (Slice 3b; T-3b-12, D-9, R-6, R-11)', () => {
  const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
  const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6Imludml0ZWVAZXhhbXBsZS5jb20ifQ.c2lnbmF0dXJl';
  const NONCE = 'N'.repeat(43);
  const googleBody = { token: TOKEN, idToken: ID_TOKEN, nonce: NONCE };
  const google = (body: unknown) => post(googleRoute.POST, '/api/public/invites/signup/google', body);

  const saved = { signin: process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID, plugin: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = CLIENT_ID;
  });
  afterEach(() => {
    for (const [name, value] of [
      ['NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID', saved.signin],
      ['NEXT_PUBLIC_GOOGLE_CLIENT_ID', saved.plugin],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('200 with only the landing page (no email), no-store and no-referrer, audit flushed', async () => {
    const response = await google(googleBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { redirectTo: '/onboarding-chat' } });
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
    expect(state.googleCalls).toEqual([googleBody]);
    expect(state.events).toEqual(['getUser', 'completeGoogleSignup', 'flush']);
  });

  it('D-9 / R-6: unconfigured → 404 before the body or the session is read', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    const response = await google(googleBody);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'google_signin_not_configured' });
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
    expect(state.events).toEqual([]);
  });

  it('R-6: the plugin client id alone does NOT switch the route on', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'plugin-client.apps.googleusercontent.com';
    expect((await google(googleBody)).status).toBe(404);
    expect(state.events).toEqual([]);
  });

  it.each([
    ['email', { email: 'attacker@example.com' }],
    ['userId', { userId: 'x' }],
    ['accountId', { accountId: 'x' }],
    ['cohort', { cohort: 'x' }],
    ['password', { password: 'correct horse battery' }],
  ])('L-1 / AC-6: an injected %s is a 400 and reaches nothing', async (_label, extra) => {
    const response = await google({ ...googleBody, ...extra });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'invalid_request' });
    expect(state.events).toEqual([]);
  });

  it.each([
    ['not JSON', '{nope'],
    ['a missing idToken', { token: TOKEN, nonce: NONCE }],
    ['a malformed idToken', { ...googleBody, idToken: 'not-a-jwt' }],
    ['a short nonce', { ...googleBody, nonce: 'abc' }],
  ])('400 invalid_request for %s, with nothing about the body logged (R-11)', async (_label, body) => {
    const response = await google(body);
    expect(response.status).toBe(400);
    expect(state.events).toEqual([]);
    expect(state.logs).toEqual([]);
  });

  it('L-8: signed in → 409 signed_in before the flow runs', async () => {
    state.user = { id: 'someone' };
    const response = await google(googleBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'signed_in' });
    expect(state.events).toEqual(['getUser']);
  });

  it('AC-2: a token that did not match gets the byte-identical validate answer', async () => {
    state.googleOutcome = { ok: false, kind: 'not_recognised' };
    const response = await google(googleBody);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ success: true, data: { state: 'not_recognised' } }));
  });

  it.each([
    [{ ok: false, kind: 'refused', status: 400, error: 'google_token_invalid' }, 400, { success: false, error: 'google_token_invalid' }],
    [{ ok: false, kind: 'refused', status: 404, error: 'google_signin_not_configured' }, 404, { success: false, error: 'google_signin_not_configured' }],
    [{ ok: false, kind: 'refused', status: 409, error: 'google_email_mismatch' }, 409, { success: false, error: 'google_email_mismatch' }],
    [{ ok: false, kind: 'refused', status: 409, error: 'google_email_unverified' }, 409, { success: false, error: 'google_email_unverified' }],
    [{ ok: false, kind: 'refused', status: 409, error: 'google_use_code' }, 409, { success: false, error: 'google_use_code' }],
    [{ ok: false, kind: 'refused', status: 409, error: 'existing_account' }, 409, { success: false, error: 'existing_account' }],
    [{ ok: false, kind: 'refused', status: 409, error: 'try_again' }, 409, { success: false, error: 'try_again' }],
    [{ ok: false, kind: 'unavailable_try_again' }, 503, { success: false, error: 'unavailable_try_again' }],
  ])('maps %j to %i, with the headers', async (outcome, status, body) => {
    state.googleOutcome = outcome;
    const response = await google(googleBody);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(headersOf(response)).toEqual({ cache: 'no-store', referrer: 'no-referrer' });
  });

  it('a throw in the flow is 503 unavailable_try_again', async () => {
    state.googleThrows = true;
    const response = await google(googleBody);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, error: 'unavailable_try_again' });
  });

  it('no invite token, ID token or nonce in any log line or response body', async () => {
    const bodies: string[] = [];
    bodies.push(await (await google(googleBody)).text());
    state.googleOutcome = { ok: false, kind: 'refused', status: 409, error: 'google_email_mismatch' };
    bodies.push(await (await google(googleBody)).text());
    bodies.push(await (await google({ ...googleBody, email: 'x@y.z' })).text());
    const text = JSON.stringify({ logs: state.logs, bodies });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(ID_TOKEN);
    expect(text).not.toContain(NONCE);
    expect(text).not.toContain('invitee@example.com');
  });
});
