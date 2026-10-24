/**
 * The self-delete subject comes from `getUser()` only (data export DE-10b.2;
 * SA C2-10, V-1), and the throttle key hides the id (O2-2).
 */

const mockGetUser = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/supabaseServerAuth', () => ({
  createAuthenticatedServerClient: async () => ({ auth: { getUser: () => mockGetUser(), getSession: () => mockGetSession() } }),
}));

import { readSessionSubject, selfDeleteThrottleKey } from '../sessionSubject';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetSession.mockReset();
});

describe('readSessionSubject', () => {
  it('the verified user id and email', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: ID, email: 'jane@example.com' } }, error: null });
    expect(await readSessionSubject()).toEqual({ id: ID, email: 'jane@example.com' });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('email null for a login without one (V-1)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: ID, email: '' } }, error: null });
    expect(await readSessionSubject()).toEqual({ id: ID, email: null });
  });

  it('null when Auth refuses or has no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no' } });
    expect(await readSessionSubject()).toBeNull();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await readSessionSubject()).toBeNull();
  });
});

describe('selfDeleteThrottleKey', () => {
  it('route plus 16 hex of the id, never the id', () => {
    const key = selfDeleteThrottleKey('account-delete', ID);
    expect(key).toMatch(/^account-delete:[0-9a-f]{16}$/);
    expect(key).not.toContain(ID);
    expect(selfDeleteThrottleKey('account-delete', ID)).toBe(key);
    expect(selfDeleteThrottleKey('account-delete', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).not.toBe(key);
  });
});
