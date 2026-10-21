/**
 * @jest-environment jsdom
 *
 * `signOutUser` (Business OS settings drawer review, slice C-c, F-23).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * Every sign-out control navigates after `signOutUser` returns, so its contract
 * is what keeps a person from being stuck or left signed in:
 *   - it never rejects, and resolves within 2 s + 5 s + 2 s = 9 s;
 *   - when the server does not confirm (5xx, network error, hang, throw), the
 *     session COOKIES are expired by shape first, then a network-free local
 *     sign-out runs;
 *   - `ok` / `error` keep their meaning; `outcome` and `clearedLocally` are new;
 *   - one sign-out at a time per page;
 *   - nothing secret reaches the logs.
 *
 * Cookies are seeded WITHOUT `Secure`: jsdom on http://localhost would drop a
 * Secure cookie silently, and a "cleared" assertion would pass for the wrong
 * reason (SA-CC-4).
 * ─────────────────────────────────────────────────────────────────────────────
 */

type SignOutAnswer = { error: { name?: string; status?: number; message: string } | null };

const events: string[] = [];
const signOutMock = jest.fn<Promise<SignOutAnswer>, [{ scope: string }]>();

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: (opts: { scope: string }) => {
        events.push(`signOut:${opts.scope}`);
        return signOutMock(opts);
      },
    },
  },
}));

type LogEntry = { level: string; fields: Record<string, unknown>; msg: string };
const logs: LogEntry[] = [];
/** CR-CC-1: when true, `info` throws, to prove a broken logger cannot make sign-out reject. */
const loggerFault = { infoThrows: false };
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (fields: Record<string, unknown>, msg: string) => {
      if (level === 'info' && loggerFault.infoThrows) throw new Error('logger down');
      logs.push({ level, fields, msg });
    };
  }
  logger.child = () => logger;
  return { clientLogger: logger };
});

import type { SignOutResult } from '../auth-actions';

type AuthActions = typeof import('../auth-actions');
/*
 * A fresh module per test: `signOutUser` keeps one in-flight promise per page
 * (single flight). If a test fails and leaves a run hanging, every later test
 * would otherwise join that run and time out, hiding which test really failed.
 */
let signOutUser: AuthActions['signOutUser'];
let PERSON_SCOPED_STORAGE_KEYS: AuthActions['PERSON_SCOPED_STORAGE_KEYS'];

/** Undo every property override, even when a test failed before its own `finally`. */
const restorers: Array<() => void> = [];

function overrideWindowStorage(name: 'localStorage' | 'sessionStorage', error: string): void {
  const original = Object.getOwnPropertyDescriptor(window, name);
  Object.defineProperty(window, name, {
    configurable: true,
    get() {
      throw new Error(error);
    },
  });
  restorers.push(() => {
    if (original) Object.defineProperty(window, name, original);
  });
}

function overrideCookie(get: () => string): void {
  Object.defineProperty(document, 'cookie', { configurable: true, get, set: () => undefined });
  // Removing the own property brings back jsdom's Document.prototype accessor.
  restorers.push(() => {
    delete (document as unknown as Record<string, unknown>).cookie;
  });
}

const REF = 'abcd';
const SESSION_NAMES = [
  `sb-${REF}-auth-token`,
  `sb-${REF}-auth-token.0`,
  `sb-${REF}-auth-token.1`,
  `sb-${REF}-auth-token.2`,
  `sb-${REF}-auth-token-code-verifier`,
  `sb-${REF}-auth-token-code-verifier.0`,
  `sb-${REF}-auth-token-user`,
];
const NOT_SESSION_NAMES = [
  'app-theme',
  'v2-theme-mode',
  `sb-${REF}-other`,
  `my-sb-${REF}-auth-token`,
  'sb-auth-token-backup',
  'sb--auth-token',
  'sb-a.b-auth-token',
  `sb-${REF}-auth-token.x`,
];

const EMAIL = 'owner@example.com';
const USER = { id: 'user-1', email: EMAIL };
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0LWFjY2Vzcy10b2tlbg.sig-ACCESS-SECRET';
const SESSION_JSON = JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: 'REFRESH-SECRET' });
const SESSION_COOKIE_VALUE = `base64-${Buffer.from(SESSION_JSON).toString('base64')}`;

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((part) => part.split('=')[0].trim())
    .filter(Boolean);
}

function clearAllCookies(): void {
  for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; Path=/`;
}

function seedSession(): void {
  for (const name of SESSION_NAMES) {
    document.cookie = `${name}=${SESSION_COOKIE_VALUE}; Path=/; SameSite=Lax`;
    localStorage.setItem(name, SESSION_JSON);
    sessionStorage.setItem(name, SESSION_JSON);
  }
}

function seedNonSession(): void {
  for (const name of NOT_SESSION_NAMES) {
    document.cookie = `${name}=keep; Path=/; SameSite=Lax`;
    localStorage.setItem(name, 'keep');
    sessionStorage.setItem(name, 'keep');
  }
}

function sessionLeft(): string[] {
  const inStorage = (store: Storage) => SESSION_NAMES.filter((n) => store.getItem(n) !== null);
  return [
    ...SESSION_NAMES.filter((n) => cookieNames().includes(n)),
    ...inStorage(localStorage),
    ...inStorage(sessionStorage),
  ];
}

/** What auth-js does on success or 401/403/404: remove the session itself. */
function authJsRemovesSession(): void {
  for (const name of SESSION_NAMES) {
    document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

const never = <T,>() => new Promise<T>(() => undefined);

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module instance per test (see above)
    ({ signOutUser, PERSON_SCOPED_STORAGE_KEYS } = require('../auth-actions') as AuthActions);
  });
  jest.useFakeTimers();
  events.length = 0;
  logs.length = 0;
  signOutMock.mockReset();
  clearAllCookies();
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = jest.fn(async () => {
    events.push('audit');
    return { ok: true, status: 200 } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  loggerFault.infoThrows = false;
  while (restorers.length) restorers.pop()?.();
  jest.useRealTimers();
});

/** Start a sign-out and expose whether it has settled. */
function start(opts: Parameters<typeof signOutUser>[0]) {
  const state: { settled: boolean; result?: SignOutResult; rejected?: unknown } = { settled: false };
  const promise = signOutUser(opts).then(
    (r) => {
      state.settled = true;
      state.result = r;
      return r;
    },
    (err) => {
      state.settled = true;
      state.rejected = err;
      throw err;
    }
  );
  return { promise, state };
}

describe('success', () => {
  it('A-1 global: audit first, one sign-out, no fallback, no timer left', async () => {
    seedSession();
    signOutMock.mockImplementation(async () => {
      authJsRemovesSession();
      return { error: null };
    });
    const result = await signOutUser({ scope: 'global', user: USER, method: 'settings' });

    expect(result).toEqual({ ok: true, error: undefined, outcome: 'signed_out', clearedLocally: true });
    expect(events).toEqual(['audit', 'signOut:global']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('/api/audit/log');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      action: 'USER_LOGOUT',
      entityType: 'user',
      entityId: 'user-1',
      userId: 'user-1',
      resourceName: EMAIL,
      severity: 'info',
      complianceFlags: ['SOC2'],
      details: { method: 'settings', scope: 'global' },
    });
    expect(jest.getTimerCount()).toBe(0);
    expect(sessionLeft()).toEqual([]);
  });

  it('A-2 local scope is passed through', async () => {
    signOutMock.mockResolvedValue({ error: null });
    await signOutUser({ scope: 'local', user: USER, method: 'invite-page' });
    expect(events).toEqual(['audit', 'signOut:local']);
  });

  it('A-3 no user: no audit write, sign-out still runs (default scope local)', async () => {
    signOutMock.mockResolvedValue({ error: null });
    const result = await signOutUser({ method: 'awaiting-payment' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toEqual(['signOut:local']);
    expect(result.ok).toBe(true);
  });

  it('E-1 a 401 reaches us as success (auth-js removed the session itself): no fallback', async () => {
    seedSession();
    signOutMock.mockImplementation(async () => {
      authJsRemovesSession();
      return { error: null };
    });
    const result = await signOutUser({ scope: 'global', user: USER });
    expect(result).toMatchObject({ ok: true, outcome: 'signed_out', clearedLocally: true });
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('D-4 a 403 is the same as E-1 (auth-js treats 401/403/404 as signed out)', async () => {
    signOutMock.mockImplementation(async () => {
      authJsRemovesSession();
      return { error: null };
    });
    const result = await signOutUser({ scope: 'global' });
    expect(result.outcome).toBe('signed_out');
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe('deadlines', () => {
  it('B-1 a hung audit holds the sign-out for 2 s, no longer', async () => {
    fetchMock.mockImplementation(() => never());
    signOutMock.mockResolvedValue({ error: null });
    const { promise } = start({ scope: 'global', user: USER });

    await jest.advanceTimersByTimeAsync(1999);
    expect(signOutMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.level === 'warn' && l.fields.step === 'audit')).toBe(true);
  });

  it('B-2 a rejecting audit does not delay the sign-out', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    signOutMock.mockResolvedValue({ error: null });
    const result = await signOutUser({ scope: 'global', user: USER });
    expect(result.ok).toBe(true);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('C-1 hung sign-out and hung fallback (the auth lock): resolves with timeout, browser cleared', async () => {
    seedSession();
    signOutMock.mockImplementation(() => never());
    const { promise, state } = start({ scope: 'global' });

    await jest.advanceTimersByTimeAsync(4999);
    expect(state.settled).toBe(false);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    // Cleared by shape at the 5 s mark, before the local fallback even starts waiting.
    expect(sessionLeft()).toEqual([]);
    await jest.advanceTimersByTimeAsync(1999);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const result = await promise;
    expect(result).toEqual({ ok: false, error: 'timeout', outcome: 'timeout', clearedLocally: true });
    expect(events).toEqual(['signOut:global', 'signOut:local']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('C-2 the local fallback runs only AFTER the session cookies are gone', async () => {
    seedSession();
    let cookiesAtFallback: string | null = null;
    signOutMock.mockImplementation(async ({ scope }) => {
      if (scope === 'global') return never<SignOutAnswer>();
      cookiesAtFallback = document.cookie;
      return { error: null };
    });
    const { promise } = start({ scope: 'global' });
    await jest.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(signOutMock.mock.calls.map(([o]) => o.scope)).toEqual(['global', 'local']);
    expect(cookiesAtFallback).not.toBeNull();
    expect(cookiesAtFallback).not.toMatch(/sb-abcd-auth-token/);
    expect(result).toMatchObject({ ok: false, outcome: 'timeout', clearedLocally: true });
  });

  it('C-3 worst case: audit, sign-out and fallback all hung -> resolves at 9 000 ms, not before', async () => {
    seedSession();
    fetchMock.mockImplementation(() => never());
    signOutMock.mockImplementation(() => never());
    const { promise, state } = start({ scope: 'global', user: USER });

    await jest.advanceTimersByTimeAsync(8999);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, error: 'timeout', outcome: 'timeout', clearedLocally: true });
  });

  it('a rejection that arrives after the deadline raises no unhandled rejection (SA-CC-5)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      signOutMock.mockImplementation(
        () => new Promise<SignOutAnswer>((_, reject) => setTimeout(() => reject(new Error('late')), 8000))
      );
      const { promise } = start({ scope: 'global' });
      await jest.advanceTimersByTimeAsync(9000);
      await promise;
      jest.useRealTimers();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('server does not confirm', () => {
  it('D-1 a 5xx: server_error, cookies cleared, then a local fallback; status logged', async () => {
    seedSession();
    signOutMock
      .mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 500, message: 'Internal Server Error' } })
      .mockResolvedValueOnce({ error: null });
    const result = await signOutUser({ scope: 'global', user: USER, method: 'settings' });

    expect(result).toEqual({ ok: false, error: 'Internal Server Error', outcome: 'server_error', clearedLocally: true });
    expect(events).toEqual(['audit', 'signOut:global', 'signOut:local']);
    expect(sessionLeft()).toEqual([]);
    const warn = logs.find((l) => l.msg.startsWith('Sign-out not confirmed'));
    expect(warn?.level).toBe('warn');
    expect(warn?.fields).toMatchObject({ scope: 'global', method: 'settings', outcome: 'server_error', authStatus: 500, authName: 'AuthApiError' });
  });

  it('D-2 a network error (AuthRetryableFetchError, status 0) is handled like D-1', async () => {
    seedSession();
    signOutMock
      .mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } })
      .mockResolvedValueOnce({ error: null });
    const result = await signOutUser({ scope: 'local' });
    expect(result).toMatchObject({ ok: false, outcome: 'server_error', clearedLocally: true });
    expect(signOutMock).toHaveBeenCalledTimes(2);
  });

  it('D-3 a rejected sign-out: threw, logged at error, still resolves and clears', async () => {
    seedSession();
    signOutMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ error: null });
    const result = await signOutUser({ scope: 'global' });
    expect(result).toEqual({ ok: false, error: 'boom', outcome: 'threw', clearedLocally: true });
    expect(logs.find((l) => l.msg.startsWith('Sign-out not confirmed'))?.level).toBe('error');
  });

  it('D-3b a synchronous throw from the client is handled the same way', async () => {
    seedSession();
    signOutMock.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    signOutMock.mockResolvedValueOnce({ error: null });
    const result = await signOutUser({ scope: 'global' });
    expect(result).toMatchObject({ ok: false, error: 'sync', outcome: 'threw', clearedLocally: true });
  });

  it('the local fallback failing too is logged, the browser is still cleared', async () => {
    seedSession();
    signOutMock
      .mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 502, message: 'Bad Gateway' } })
      .mockRejectedValueOnce(new Error('still down'));
    const result = await signOutUser({ scope: 'global' });
    expect(result).toMatchObject({ ok: false, outcome: 'server_error', clearedLocally: true });
    expect(logs.some((l) => l.fields.step === 'local-fallback' && l.fields.outcome === 'threw')).toBe(true);
  });
});

describe('what is cleared', () => {
  it('F-1 every session cookie and storage key, chunks and side keys included', async () => {
    seedSession();
    expect(sessionLeft().length).toBe(SESSION_NAMES.length * 3);
    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    const result = await signOutUser({ scope: 'global' });
    expect(sessionLeft()).toEqual([]);
    expect(result.clearedLocally).toBe(true);
  });

  it('F-2 keeps what is not a session (anchor, ref and chunk-suffix checks), on failure and success', async () => {
    seedSession();
    seedNonSession();
    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    await signOutUser({ scope: 'global' });
    for (const name of NOT_SESSION_NAMES) {
      expect(cookieNames()).toContain(name);
      expect(localStorage.getItem(name)).toBe('keep');
      expect(sessionStorage.getItem(name)).toBe('keep');
    }

    signOutMock.mockReset();
    signOutMock.mockResolvedValue({ error: null });
    await signOutUser({ scope: 'global' });
    for (const name of NOT_SESSION_NAMES) expect(localStorage.getItem(name)).toBe('keep');
  });

  it('F-3 person-scoped and legacy keys are removed from both storages, on success and on failure', async () => {
    expect(PERSON_SCOPED_STORAGE_KEYS).not.toContain('sb-auth-token');
    expect(PERSON_SCOPED_STORAGE_KEYS).not.toContain('supabase.auth.token');

    const seedPerson = () => {
      for (const key of [...PERSON_SCOPED_STORAGE_KEYS, 'sb-auth-token', 'supabase.auth.token', 'onboarding_preview_data']) {
        localStorage.setItem(key, 'x');
        sessionStorage.setItem(key, 'x');
      }
    };
    const leftovers = () =>
      [...PERSON_SCOPED_STORAGE_KEYS, 'sb-auth-token', 'supabase.auth.token', 'onboarding_preview_data'].filter(
        (key) => localStorage.getItem(key) !== null || sessionStorage.getItem(key) !== null
      );

    seedPerson();
    signOutMock.mockResolvedValue({ error: null });
    await signOutUser({ scope: 'global' });
    expect(leftovers()).toEqual([]);

    seedPerson();
    signOutMock.mockReset();
    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    await signOutUser({ scope: 'global' });
    expect(leftovers()).toEqual([]);
  });

  it('F-4 storage that throws: still resolves, cookies still cleared', async () => {
    seedSession();
    overrideWindowStorage('localStorage', 'SecurityError');
    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    const result = await signOutUser({ scope: 'global' });
    expect(result.outcome).toBe('server_error');
    expect(SESSION_NAMES.filter((n) => cookieNames().includes(n))).toEqual([]);
  });

  it('SA-CC-3 clearedLocally is measured: a cookie that survives is reported, with a count only', async () => {
    overrideCookie(() => `sb-${REF}-auth-token.0=${SESSION_COOKIE_VALUE}`);
    signOutMock.mockResolvedValue({ error: null });
    const result = await signOutUser({ scope: 'global' });
    expect(result).toMatchObject({ ok: true, outcome: 'signed_out', clearedLocally: false });
    const warn = logs.find((l) => l.msg === 'Session keys survived the sign-out clear');
    expect(warn?.level).toBe('warn');
    expect(warn?.fields).toEqual({ left: 1 });
  });
});

describe('never rejects (F-5)', () => {
  const cases: Array<[string, () => void]> = [
    ['audit fetch throws synchronously', () => {
      fetchMock.mockImplementation(() => {
        throw new Error('fetch sync');
      });
      signOutMock.mockResolvedValue({ error: null });
    }],
    ['sign-out rejects', () => {
      signOutMock.mockRejectedValue(new Error('reject'));
    }],
    ['sign-out resolves with no value (an unexpected throw inside the flow)', () => {
      signOutMock.mockResolvedValue(undefined as unknown as SignOutAnswer);
    }],
    ['local fallback throws', () => {
      signOutMock
        .mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 500, message: 'x' } })
        .mockImplementationOnce(() => {
          throw new Error('fallback');
        });
    }],
    ['document.cookie getter throws', () => {
      signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
      overrideCookie(() => {
        throw new Error('cookie');
      });
    }],
    ['sessionStorage getter throws', () => {
      signOutMock.mockResolvedValue({ error: null });
      overrideWindowStorage('sessionStorage', 'storage');
    }],
  ];

  it.each(cases)('%s', async (_label, arrange) => {
    seedSession();
    arrange();
    await expect(signOutUser({ scope: 'global', user: USER })).resolves.toEqual(
      expect.objectContaining({ outcome: expect.any(String), clearedLocally: expect.any(Boolean) })
    );
  });
});

describe('single flight (SA-CC-6)', () => {
  it('two concurrent calls share one run: one audit, one sign-out, the same result', async () => {
    let resolveSignOut: (a: SignOutAnswer) => void = () => undefined;
    signOutMock.mockImplementation(() => new Promise<SignOutAnswer>((r) => (resolveSignOut = r)));
    const first = signOutUser({ scope: 'global', user: USER, method: 'user-menu' });
    const second = signOutUser({ scope: 'local', user: USER, method: 'other' });
    expect(second).toBe(first);
    await jest.advanceTimersByTimeAsync(0);
    resolveSignOut({ error: null });
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.level === 'debug' && l.fields.method === 'other')).toBe(true);
  });

  it('a call after the first has settled runs again', async () => {
    signOutMock.mockResolvedValue({ error: null });
    await signOutUser({ scope: 'global' });
    await signOutUser({ scope: 'global' });
    expect(signOutMock).toHaveBeenCalledTimes(2);
  });

  it('after an injected throw the slot is still cleared', async () => {
    signOutMock.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    await signOutUser({ scope: 'global' });
    signOutMock.mockResolvedValue({ error: null });
    const result = await signOutUser({ scope: 'global' });
    expect(result.ok).toBe(true);
    expect(signOutMock).toHaveBeenCalledTimes(3);
  });
});

describe('logging (L-1, SA-CC-14)', () => {
  it('no email, token, decoded token, cookie name or value, or user id in any log entry', async () => {
    seedSession();
    signOutMock
      .mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 500, message: 'x' } })
      .mockResolvedValueOnce({ error: null });
    await signOutUser({ scope: 'global', user: USER, method: 'settings' });

    signOutMock.mockReset();
    seedSession();
    signOutMock.mockRejectedValueOnce(Object.assign(new Error(`bad token ${ACCESS_TOKEN}`), { status: 500 }));
    signOutMock.mockResolvedValueOnce({ error: null });
    await signOutUser({ scope: 'global', user: USER, method: 'settings' });

    // QA-CC-2: the UNEXPECTED-throw path (outer catch). Reading the answer's
    // `error` throws an error whose message carries the token.
    signOutMock.mockReset();
    seedSession();
    signOutMock.mockResolvedValueOnce({
      get error(): SignOutAnswer['error'] {
        throw Object.assign(new Error(`unexpected ${ACCESS_TOKEN} ${EMAIL}`), { status: 599 });
      },
    } as SignOutAnswer);
    const unexpected = await signOutUser({ scope: 'global', user: USER, method: 'settings' });
    expect(unexpected.outcome).toBe('threw');
    const unexpectedEntry = logs.find((l) => l.fields.step === 'unexpected');
    expect(unexpectedEntry?.level).toBe('error');
    expect(unexpectedEntry?.fields).toEqual({ step: 'unexpected', authStatus: 599, authName: 'Error' });

    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [EMAIL, ACCESS_TOKEN, 'REFRESH-SECRET', SESSION_COOKIE_VALUE, 'base64-', `sb-${REF}-auth-token`, 'user-1']) {
      expect(text).not.toContain(secret);
    }
    // No raw error object rides along on any entry.
    expect(logs.every((l) => !('err' in l.fields))).toBe(true);
  });
});

describe('cookie expiry attributes (QA-CC-1)', () => {
  /**
   * jsdom accepts `SameSite=None` without `Secure` and runs at `/`, so a wrong
   * attribute passes a "cookie is gone" check here while a real browser keeps
   * the session cookie. So every expiry WRITE is pinned, and one test runs at
   * a nested path, where a missing `Path=/` would default to `/business-os`.
   */
  function spyOnCookieWrites(): string[] {
    const proto = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!proto?.get || !proto.set) throw new Error('jsdom has no Document.prototype.cookie accessor');
    const writes: string[] = [];
    const { get, set } = proto;
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        return get.call(document);
      },
      set(value: string) {
        writes.push(value);
        set.call(document, value);
      },
    });
    restorers.push(() => {
      delete (document as unknown as Record<string, unknown>).cookie;
    });
    return writes;
  }

  it('every expiry write carries Max-Age=0, Expires 1970, Path=/, SameSite=Lax, and never SameSite=None or Domain=', async () => {
    seedSession();
    const writes = spyOnCookieWrites();
    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    await signOutUser({ scope: 'global' });

    const expiries = writes.filter((w) => /^sb-[^=]*=;/.test(w));
    expect(expiries.length).toBeGreaterThanOrEqual(SESSION_NAMES.length);
    for (const write of expiries) {
      expect(write).toContain('Max-Age=0');
      expect(write).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(write).toMatch(/;\s*Path=\/(;|$)/);
      expect(write).toMatch(/;\s*SameSite=Lax(;|$)/);
      expect(write).not.toMatch(/SameSite=None/i);
      expect(write).not.toMatch(/Domain=/i);
    }
  });

  it('at a nested page path, a Path=/ session cookie is really removed', async () => {
    window.history.pushState({}, '', '/business-os/settings');
    restorers.push(() => window.history.pushState({}, '', '/'));
    document.cookie = `sb-${REF}-auth-token.0=${SESSION_COOKIE_VALUE}; Path=/; SameSite=Lax`;
    document.cookie = `sb-${REF}-auth-token.1=${SESSION_COOKIE_VALUE}; Path=/; SameSite=Lax`;
    expect(cookieNames()).toContain(`sb-${REF}-auth-token.0`);

    signOutMock.mockResolvedValue({ error: { name: 'AuthApiError', status: 500, message: 'x' } });
    const result = await signOutUser({ scope: 'global' });

    expect(cookieNames().filter((n) => n.startsWith(`sb-${REF}-auth-token`))).toEqual([]);
    expect(result.clearedLocally).toBe(true);
  });
});

describe('a throwing logger (CR-CC-1)', () => {
  it('still resolves, with an unverified local clear', async () => {
    seedSession();
    loggerFault.infoThrows = true;
    signOutMock.mockResolvedValue({ error: null });
    await expect(signOutUser({ scope: 'global' })).resolves.toEqual({
      ok: false,
      error: 'Sign-out failed',
      outcome: 'threw',
      clearedLocally: false,
    });
  });
});
