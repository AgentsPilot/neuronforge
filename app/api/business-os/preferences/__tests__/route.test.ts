/**
 * PATCH /api/business-os/preferences — the server side of the language and
 * currency pickers (LanguageContext) and of the settings page's timezone save
 * (settings drawer D-1).
 *
 * CLAUDE.md minimum (happy path, auth failure, invalid input), plus the two
 * rules this route exists to hold: a language writes BOTH columns, and a
 * currency the database refuses comes back as 409 CURRENCY_LOCKED, not 500.
 * Every write must be for the SESSION user, never one named in the body.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => auditLog(...a) }) },
}));

const upsertPreferredLanguage = jest.fn();
const findLocale = jest.fn();
const saveConfirmedTimezone = jest.fn();
const findPreferredLanguage = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    upsertPreferredLanguage: (...a: unknown[]) => upsertPreferredLanguage(...a),
    findLocale: (...a: unknown[]) => findLocale(...a),
    saveConfirmedTimezone: (...a: unknown[]) => saveConfirmedTimezone(...a),
    findPreferredLanguage: (...a: unknown[]) => findPreferredLanguage(...a),
  },
}));

const updateTimezoneMirror = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    updateTimezoneMirror: (...a: unknown[]) => updateTimezoneMirror(...a),
  },
}));

const updateLanguage = jest.fn();
const updateDefaultCurrency = jest.fn();
const findDefaultCurrency = jest.fn();
const findLanguage = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    updateLanguage: (...a: unknown[]) => updateLanguage(...a),
    updateDefaultCurrency: (...a: unknown[]) => updateDefaultCurrency(...a),
    findDefaultCurrency: (...a: unknown[]) => findDefaultCurrency(...a),
    findLanguage: (...a: unknown[]) => findLanguage(...a),
  },
}));

import { createLogger } from '@/lib/logger';
import { GET, PATCH } from '../route';

/** The mocked logger: one shared object (its `child` returns itself). */
const log = createLogger({ module: 'test' }) as unknown as Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;

const SESSION_USER = { id: 'session-user-id', email: 'owner@example.com' };

function req(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/business-os/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function noWrites() {
  expect(upsertPreferredLanguage).not.toHaveBeenCalled();
  expect(updateLanguage).not.toHaveBeenCalled();
  expect(updateDefaultCurrency).not.toHaveBeenCalled();
  expect(saveConfirmedTimezone).not.toHaveBeenCalled();
  expect(updateTimezoneMirror).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(SESSION_USER);
  auditLog.mockResolvedValue(undefined);
  upsertPreferredLanguage.mockResolvedValue({ data: true, error: null });
  updateLanguage.mockResolvedValue({ data: true, error: null });
  updateDefaultCurrency.mockResolvedValue({ data: true, error: null });
  findLocale.mockResolvedValue({ data: { preferredLanguage: 'he', timezone: 'Asia/Jerusalem' }, error: null });
  findDefaultCurrency.mockResolvedValue({ data: 'USD', error: null });
  findLanguage.mockResolvedValue({ data: 'he', error: null });
  saveConfirmedTimezone.mockResolvedValue({ data: true, error: null });
  updateTimezoneMirror.mockResolvedValue({ data: true, error: null });
  findPreferredLanguage.mockResolvedValue({ data: 'es', error: null });
});

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/business-os/preferences', { method: 'GET' });
}

describe('GET /api/business-os/preferences', () => {
  it("returns the session user's stored language, timezone and business currency", async () => {
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        locale: { preferredLanguage: 'he', timezone: 'Asia/Jerusalem' },
        currency: { businessCurrency: 'USD' },
      },
    });
    expect(findLocale).toHaveBeenCalledWith(SESSION_USER.id);
    expect(findDefaultCurrency).toHaveBeenCalledWith(SESSION_USER.id);
    noWrites();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('returns nulls, not defaults, when nothing is stored', async () => {
    findLocale.mockResolvedValue({ data: { preferredLanguage: null, timezone: null }, error: null });
    findDefaultCurrency.mockResolvedValue({ data: null, error: null });
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      locale: { preferredLanguage: null, timezone: null },
      currency: { businessCurrency: null },
    });
  });

  it('401s with no session and reads nothing', async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(findLocale).not.toHaveBeenCalled();
    expect(findDefaultCurrency).not.toHaveBeenCalled();
  });

  it('keeps the locale when only the currency read fails (that half is null, not a default)', async () => {
    findDefaultCurrency.mockResolvedValue({ data: null, error: new Error('secret detail') });
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      locale: { preferredLanguage: 'he', timezone: 'Asia/Jerusalem' },
      currency: null,
    });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('keeps the currency when only the locale read fails, so no backfill is implied', async () => {
    findLocale.mockResolvedValue({ data: null, error: new Error('secret detail') });
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    // `locale: null` means "unknown", distinct from a locale of nulls ("nothing stored").
    expect(body.data).toEqual({ locale: null, currency: { businessCurrency: 'USD' } });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('500s, without leaking the error, when both reads fail', async () => {
    findLocale.mockResolvedValue({ data: null, error: new Error('secret detail') });
    findDefaultCurrency.mockResolvedValue({ data: null, error: new Error('secret detail') });
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});

describe('PATCH /api/business-os/preferences', () => {
  describe('happy path', () => {
    it('writes the language to BOTH tables for the session user', async () => {
      const res = await PATCH(req({ language: 'he' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { language: 'he' } });
      expect(upsertPreferredLanguage).toHaveBeenCalledWith(SESSION_USER.id, 'he');
      expect(updateLanguage).toHaveBeenCalledWith(SESSION_USER.id, 'he');
      expect(updateDefaultCurrency).not.toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SETTINGS_PREFERENCES_UPDATED', userId: SESSION_USER.id })
      );
    });

    it('writes the business currency for the session user, and nothing else', async () => {
      const res = await PATCH(req({ currency: 'ILS' }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { currency: 'ILS' } });
      expect(updateDefaultCurrency).toHaveBeenCalledWith(SESSION_USER.id, 'ILS');
      expect(upsertPreferredLanguage).not.toHaveBeenCalled();
      expect(updateLanguage).not.toHaveBeenCalled();
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SETTINGS_CURRENCY_CHANGED', userId: SESSION_USER.id })
      );
    });

    it('still succeeds when the audit write fails (non-blocking)', async () => {
      auditLog.mockRejectedValue(new Error('audit down'));
      const res = await PATCH(req({ currency: 'EUR' }));
      expect(res.status).toBe(200);
    });
  });

  describe('auth failure', () => {
    it('401s with no session and writes nothing', async () => {
      getUser.mockResolvedValue(null);
      const res = await PATCH(req({ language: 'en' }));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
      noWrites();
    });
  });

  describe('invalid input', () => {
    it.each([
      ['an unsupported language', { language: 'fr' }],
      ['an unsupported currency', { currency: 'JPY' }],
      ['a lowercase currency', { currency: 'usd' }],
      ['an empty body', {}],
      ['both settings at once', { language: 'en', currency: 'USD' }],
      ['a userId smuggled beside a valid value', { language: 'en', userId: 'someone-else' }],
      // Was `{ timezone: 'UTC' }` until D-1 made timezone a setting (SA-D1-3).
      ['an unknown field', { theme: 'dark' }],
    ])('400s on %s and writes nothing', async (_label, body) => {
      const res = await PATCH(req(body));

      expect(res.status).toBe(400);
      expect((await res.json()).success).toBe(false);
      noWrites();
    });

    it('400s on a body that is not JSON', async () => {
      const res = await PATCH(req('{not json', true));
      expect(res.status).toBe(400);
      noWrites();
    });
  });

  describe('failures', () => {
    it('409 CURRENCY_LOCKED when the database refuses the change (23514), no audit', async () => {
      updateDefaultCurrency.mockResolvedValue({
        data: null,
        error: Object.assign(new Error('Cannot change the business currency'), { code: '23514' }),
      });
      const res = await PATCH(req({ currency: 'USD' }));

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ success: false, code: 'CURRENCY_LOCKED' });
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('500 on any other currency error, without leaking its message', async () => {
      updateDefaultCurrency.mockResolvedValue({
        data: null,
        error: Object.assign(new Error('secret internal detail'), { code: '42703' }),
      });
      const res = await PATCH(req({ currency: 'USD' }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain('secret internal detail');
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('500 when either language write fails, no audit', async () => {
      updateLanguage.mockResolvedValue({ data: null, error: new Error('boom') });
      const res = await PATCH(req({ language: 'es' }));

      expect(res.status).toBe(500);
      expect(upsertPreferredLanguage).toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });
  });
});

/**
 * PATCH { timezone } (settings drawer D-1). The authority is written first,
 * then the best-effort `profiles` mirror, then the authority is READ BACK and
 * success means it equals what was sent, strictly. The zone is stored exactly
 * as picked; the browser never supplies a language or a user id.
 */
describe('PATCH { timezone }', () => {
  /** The read-back returns `zone` as stored. */
  function readsBack(zone: string | null) {
    findLocale.mockResolvedValue({ data: { preferredLanguage: 'he', timezone: zone }, error: null });
  }

  /** Every logged argument, as one string, to prove what was (not) logged. */
  function allLogged(): string {
    return JSON.stringify(
      (['info', 'warn', 'error', 'debug'] as const).flatMap((level) => log[level].mock.calls)
    );
  }

  beforeEach(() => readsBack('Asia/Jerusalem'));

  it('R-1: writes the authority, then the mirror, then reads it back, for the session user, and audits', async () => {
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { timezone: 'Asia/Jerusalem' } });

    expect(saveConfirmedTimezone).toHaveBeenCalledTimes(1);
    const [userId, zone, options] = saveConfirmedTimezone.mock.calls[0];
    expect(userId).toBe(SESSION_USER.id);
    expect(zone).toBe('Asia/Jerusalem');
    expect(options).toEqual({ languageForNewRow: 'he', confirmedAt: expect.any(String) });
    expect(new Date(options.confirmedAt).toISOString()).toBe(options.confirmedAt);

    // One stamp for both tables (SA-D1-2).
    expect(updateTimezoneMirror).toHaveBeenCalledWith(SESSION_USER.id, 'Asia/Jerusalem', options.confirmedAt);
    expect(findLocale).toHaveBeenCalledWith(SESSION_USER.id);
    expect(findLanguage).toHaveBeenCalledWith(SESSION_USER.id);

    // Order: language lookup, authority, mirror, read-back.
    const order = [findLanguage, saveConfirmedTimezone, updateTimezoneMirror, findLocale].map(
      (fn) => fn.mock.invocationCallOrder[0]
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SETTINGS_PREFERENCES_UPDATED',
        entityType: 'settings',
        entityId: SESSION_USER.id,
        userId: SESSION_USER.id,
        changes: { after: { timezone: 'Asia/Jerusalem' } },
      })
    );
    expect(upsertPreferredLanguage).not.toHaveBeenCalled();
    expect(updateLanguage).not.toHaveBeenCalled();
    expect(updateDefaultCurrency).not.toHaveBeenCalled();
  });

  it.each(['UTC', 'Etc/UTC', 'utc', 'EST', 'Etc/GMT+5', 'America/Argentina/Buenos_Aires'])(
    'R-2: accepts %j and stores it verbatim (no canonicalisation)',
    async (zone) => {
      readsBack(zone);
      const res = await PATCH(req({ timezone: zone }));

      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ timezone: zone });
      expect(saveConfirmedTimezone.mock.calls[0][1]).toBe(zone);
      expect(updateTimezoneMirror.mock.calls[0][1]).toBe(zone);
    }
  );

  it('R-3: 401s with no session, reads and writes nothing, no audit', async () => {
    getUser.mockResolvedValue(null);
    const res = await PATCH(req({ timezone: 'UTC' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    noWrites();
    expect(findLanguage).not.toHaveBeenCalled();
    expect(findLocale).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a leading space (no trim)', ' UTC'],
    ['a trailing space (no trim)', 'UTC '],
    ['an unknown zone', 'Foo/Bar'],
    ['R-16: an unknown zone with a leading letter', 'Mars/Olympus'],
    ['an offset ID', '+05'],
    ['a four-digit offset ID', '+0500'],
    ['an offset with a colon', '+05:00'],
    ['null', null],
    ['a number', 42],
    ['65 characters', `A${'a'.repeat(64)}`],
    ['a semicolon', 'Asia/Jerusalem;drop'],
  ])('R-4: 400s on %s and writes nothing', async (_label, timezone) => {
    const res = await PATCH(req({ timezone }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'Invalid input' });
    noWrites();
    expect(findLocale).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['user_id', { timezone: 'UTC', user_id: 'someone-else' }],
    ['id', { timezone: 'UTC', id: 'someone-else' }],
    ['userId', { timezone: 'UTC', userId: 'someone-else' }],
  ])('R-5: 400s when %s is smuggled beside a valid zone', async (_label, body) => {
    const res = await PATCH(req(body));

    expect(res.status).toBe(400);
    noWrites();
  });

  it.each([
    ['a language', { timezone: 'UTC', language: 'he' }],
    ['a currency', { timezone: 'UTC', currency: 'USD' }],
  ])('R-6: 400s on a timezone with %s (one setting per request)', async (_label, body) => {
    const res = await PATCH(req(body));

    expect(res.status).toBe(400);
    noWrites();
  });

  it("R-7: a new row's language is the business's, never the browser's or the stored preference", async () => {
    findLanguage.mockResolvedValue({ data: 'es', error: null });
    readsBack('UTC');
    const res = await PATCH(req({ timezone: 'UTC' }));

    expect(res.status).toBe(200);
    expect(saveConfirmedTimezone.mock.calls[0][2]).toMatchObject({ languageForNewRow: 'es' });
    expect(findPreferredLanguage).not.toHaveBeenCalled();
  });

  it.each([
    ['no business language', () => findLanguage.mockResolvedValue({ data: null, error: null }), 'debug'],
    ['an unsupported language', () => findLanguage.mockResolvedValue({ data: 'fr', error: null }), 'debug'],
    ['a lookup error', () => findLanguage.mockResolvedValue({ data: null, error: new Error('db') }), 'warn'],
    ['a rejected lookup', () => findLanguage.mockRejectedValue(new Error('thrown')), 'warn'],
  ])('R-8: saves with no new-row language on %s, and logs at %s', async (_label, arrange, level) => {
    arrange();
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(200);
    expect(saveConfirmedTimezone.mock.calls[0][2]).toMatchObject({ languageForNewRow: null });
    expect(auditLog).toHaveBeenCalled();
    // A real failure warns; a missing or unsupported value only debugs (SA-D1-4).
    expect(log.warn).toHaveBeenCalledTimes(level === 'warn' ? 1 : 0);
    if (level === 'debug') expect(log.debug).toHaveBeenCalled();
  });

  it('R-9: 500 when the authority write fails; no mirror, no read-back, no audit, no leak', async () => {
    saveConfirmedTimezone.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('secret internal detail'), { code: '42501' }),
    });
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to save the timezone' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(updateTimezoneMirror).not.toHaveBeenCalled();
    expect(findLocale).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R-10: a failed mirror is logged but the save still succeeds and is audited', async () => {
    updateTimezoneMirror.mockResolvedValue({ data: null, error: new Error('mirror down') });
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(200);
    expect(findLocale).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION_USER.id }),
      'Timezone mirror onto the profile failed (best-effort)'
    );
  });

  it('R-11: 500 when the read-back differs, no audit, and the stored value is never logged as text', async () => {
    readsBack('Hand/Edited-Value');
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to save the timezone' });
    expect(auditLog).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ readFailed: false, storedLength: 'Hand/Edited-Value'.length }),
      'The timezone did not persist'
    );
    expect(allLogged()).not.toContain('Hand/Edited-Value');
  });

  it('R-11b: 500 when the read-back differs only by whitespace (strict, no trim)', async () => {
    readsBack(' Asia/Jerusalem');
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(500);
    expect(auditLog).not.toHaveBeenCalled();
  });

  // QA EC-1: a case-insensitive comparison would call this a success, but the
  // stored text is not what the owner picked, so the save must fail.
  it('R-11c: 500 when the read-back differs only by case (strict, no lowercasing)', async () => {
    readsBack('asia/jerusalem');
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(saveConfirmedTimezone).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to save the timezone' });
    expect(auditLog).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ readFailed: false, storedLength: 'asia/jerusalem'.length }),
      'The timezone did not persist'
    );
  });

  it('R-12: 500 when the read-back fails, no audit, no leak', async () => {
    findLocale.mockResolvedValue({ data: null, error: new Error('secret read detail') });
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret read detail');
    expect(auditLog).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ readFailed: true, storedLength: null }),
      'The timezone did not persist'
    );
  });

  it('R-13: 500 when the read-back finds no timezone (null never equals a zone)', async () => {
    readsBack(null);
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(500);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R-14: still 200 when the audit write fails (non-blocking)', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    const res = await PATCH(req({ timezone: 'Asia/Jerusalem' }));

    expect(res.status).toBe(200);
  });
});

/*
 * QA EC-3: the outer `catch` of both handlers. A repository that THROWS (rather
 * than returning `{ error }`) lands there; the error text may carry internals,
 * so it is returned as `details` only in development (CLAUDE.md, Error Response
 * Format). One case per branch that can throw, in both environments.
 */
describe('unexpected errors: the outer catch leaks details only in development', () => {
  const SECRET = 'secret internal detail from a thrown error';
  // NODE_ENV is typed read-only by Next's ambient types; the tests must flip it.
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
  });

  const cases: Array<[string, () => Promise<Response>]> = [
    ['GET', async () => {
      findLocale.mockRejectedValue(new Error(SECRET));
      return GET(getReq());
    }],
    ['PATCH { timezone }', async () => {
      saveConfirmedTimezone.mockRejectedValue(new Error(SECRET));
      return PATCH(req({ timezone: 'Asia/Jerusalem' }));
    }],
    ['PATCH { language }', async () => {
      upsertPreferredLanguage.mockRejectedValue(new Error(SECRET));
      return PATCH(req({ language: 'en' }));
    }],
    ['PATCH { currency }', async () => {
      updateDefaultCurrency.mockRejectedValue(new Error(SECRET));
      return PATCH(req({ currency: 'EUR' }));
    }],
  ];

  it.each(cases)('%s: 500 with no details outside development', async (_name, run) => {
    for (const nodeEnv of ['production', 'test']) {
      env.NODE_ENV = nodeEnv;
      const res = await run();
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: 'Internal server error' });
      expect('details' in body).toBe(false);
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
    expect(auditLog).not.toHaveBeenCalled();
  });

  // Positive control: the same path DOES carry the message in development, so
  // the assertion above is about the guard, not about a path that never reaches it.
  it.each(cases)('%s: 500 with the error message as details in development', async (_name, run) => {
    env.NODE_ENV = 'development';
    const res = await run();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Internal server error', details: SECRET });
    expect(auditLog).not.toHaveBeenCalled();
  });
});
