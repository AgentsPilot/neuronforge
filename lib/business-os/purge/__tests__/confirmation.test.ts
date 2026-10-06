/**
 * Admin delete AD-2a (T5, SA AC2-8): the shared typed-confirmation helper.
 * Name first, email fallback only when the name is genuinely absent, and a
 * profile READ ERROR is `unverified` (never the email fallback).
 */

const mockFindProfile = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => mockFindProfile(...a) },
}));

import { confirmationMatches, normaliseConfirmation, resolveConfirmationTarget } from '../confirmation';

const USER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => mockFindProfile.mockReset());

describe('resolveConfirmationTarget', () => {
  it('the business name when there is one, read for the given id', async () => {
    mockFindProfile.mockResolvedValue({ data: { company_name: 'Acme Co' }, error: null });
    expect(await resolveConfirmationTarget(USER, 'a@x.com')).toEqual({ status: 'ok', kind: 'business name', value: 'Acme Co' });
    expect(mockFindProfile).toHaveBeenCalledWith(USER);
  });

  it('the email when there is no profile, or an empty name', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    expect(await resolveConfirmationTarget(USER, 'a@x.com')).toEqual({ status: 'ok', kind: 'account email', value: 'a@x.com' });
    mockFindProfile.mockResolvedValue({ data: { company_name: '   ' }, error: null });
    expect(await resolveConfirmationTarget(USER, 'a@x.com')).toEqual({ status: 'ok', kind: 'account email', value: 'a@x.com' });
  });

  it('none when neither exists', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: null });
    expect(await resolveConfirmationTarget(USER, null)).toEqual({ status: 'none' });
  });

  it('unverified on a returned read error, even with an email available', async () => {
    mockFindProfile.mockResolvedValue({ data: null, error: new Error('db') });
    expect(await resolveConfirmationTarget(USER, 'a@x.com')).toEqual({ status: 'unverified' });
  });

  it('unverified on a thrown read', async () => {
    mockFindProfile.mockRejectedValue(new Error('boom'));
    expect(await resolveConfirmationTarget(USER, 'a@x.com')).toEqual({ status: 'unverified' });
  });
});

describe('normalise / match', () => {
  it('trims, collapses whitespace and ignores case', () => {
    expect(normaliseConfirmation('  Acme   TEST\tco ')).toBe('acme test co');
    expect(confirmationMatches('  acme   TEST  co ', 'Acme Test Co')).toBe(true);
  });

  it('a different value does not match', () => {
    expect(confirmationMatches('Acme', 'Acme Co')).toBe(false);
  });
});
