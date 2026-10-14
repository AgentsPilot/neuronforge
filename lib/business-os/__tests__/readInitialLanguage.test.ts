/**
 * `readInitialLanguage`: the server read behind the owner's first frame
 * (performance business round BR-1a, SA P-1; workplan §8.1 H-1..H-10).
 *
 * The helper sits in the layout of every owner page, so the properties that
 * matter are the ones a layout cannot show: it never throws, it reads only the
 * session user's own row, it returns the language and nothing else, and it
 * accepts exactly the values the client settles on.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));

const findLocale = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: { findLocale: (...a: unknown[]) => findLocale(...a) },
}));

const warn = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';

const USER = { id: '11111111-2222-3333-4444-555555555555' };

const locale = (preferredLanguage: string | null, timezone: string | null = 'Asia/Jerusalem') => ({
  data: { preferredLanguage, timezone },
  error: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(USER);
});

describe('a usable saved language (H-1)', () => {
  it.each(['he', 'es', 'en'] as const)('returns saved %s', async (lang) => {
    findLocale.mockResolvedValue(locale(lang));
    await expect(readInitialLanguage()).resolves.toEqual({ language: lang, source: 'saved' });
  });
});

describe('nothing usable saved (H-2, H-3)', () => {
  it('null is none, in English', async () => {
    findLocale.mockResolvedValue(locale(null));
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'none' });
  });

  // Exact match, like the client (SA M-6). A normalised 'HE' would draw Hebrew
  // first while the client backfills this browser's pick over the same row.
  it.each(['fr', 'HE', ' he', 'he ', '', 'iw'])('%j is none, not normalised', async (value) => {
    findLocale.mockResolvedValue(locale(value));
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'none' });
  });

  it('a missing data object is none', async () => {
    findLocale.mockResolvedValue({ data: null, error: null });
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'none' });
  });
});

describe('failures are unknown, in English, and never throw (H-4..H-7, AC-1.5a)', () => {
  it('a repository error', async () => {
    findLocale.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'unknown' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a throwing repository', async () => {
    findLocale.mockRejectedValue(new Error('boom'));
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'unknown' });
  });

  it('no session: nothing is read', async () => {
    getUser.mockResolvedValue(null);
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'unknown' });
    expect(findLocale).not.toHaveBeenCalled();
  });

  it('a throwing session read', async () => {
    getUser.mockRejectedValue(new Error('auth down'));
    await expect(readInitialLanguage()).resolves.toEqual({ language: 'en', source: 'unknown' });
    expect(findLocale).not.toHaveBeenCalled();
  });
});

describe('scope and shape (H-8, H-9)', () => {
  it('reads the session user, once', async () => {
    findLocale.mockResolvedValue(locale('he'));
    await readInitialLanguage();
    expect(findLocale).toHaveBeenCalledTimes(1);
    expect(findLocale).toHaveBeenCalledWith(USER.id);
  });

  it('returns the language and the source only: never the timezone (SA-6)', async () => {
    findLocale.mockResolvedValue(locale('he', 'Asia/Jerusalem'));
    const result = await readInitialLanguage();
    expect(Object.keys(result).sort()).toEqual(['language', 'source']);
  });

  it('takes no argument, so no caller-supplied id can reach the read', () => {
    expect(readInitialLanguage.length).toBe(0);
  });
});

describe('source (H-10)', () => {
  const text = readFileSync(join(process.cwd(), 'lib/business-os/readInitialLanguage.ts'), 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it("is server-only, as its first import", () => {
    expect(code.trim().startsWith("import 'server-only';")).toBe(true);
  });

  it('reads through the repository with the session id, and touches no client or cookie', () => {
    expect(code).toMatch(/userPreferencesRepository\.findLocale\(user\.id\)/);
    expect(code).not.toMatch(/supabase/i);
    expect(code).not.toMatch(/cookies\(/);
    expect(code).not.toMatch(/business-os\/entitlements/);
  });
});
