/**
 * PATCH /api/business-os/preferences — the server side of the language and
 * currency pickers (LanguageContext).
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
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    upsertPreferredLanguage: (...a: unknown[]) => upsertPreferredLanguage(...a),
    findLocale: (...a: unknown[]) => findLocale(...a),
  },
}));

const updateLanguage = jest.fn();
const updateDefaultCurrency = jest.fn();
const findDefaultCurrency = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    updateLanguage: (...a: unknown[]) => updateLanguage(...a),
    updateDefaultCurrency: (...a: unknown[]) => updateDefaultCurrency(...a),
    findDefaultCurrency: (...a: unknown[]) => findDefaultCurrency(...a),
  },
}));

import { GET, PATCH } from '../route';

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
      ['an unknown field', { timezone: 'UTC' }],
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
