/**
 * QA (2026-10-02, ADMIN_HEADER_IDENTITY_WORKPLAN): `resolveAdminDisplayName` is
 * what `app/admin/layout.tsx` awaits. The pure chain is covered in
 * AdminHeader.render.test.tsx; this pins the repository wiring — no profile
 * row and a failed profile read must both degrade to the email, never throw
 * (a throw here would 500 every admin page).
 */

const findById = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findById: (id: string) => findById(id) },
}));

import { resolveAdminDisplayName, ADMIN_NAME_FALLBACK } from '../adminDisplayName';

describe('resolveAdminDisplayName', () => {
  beforeEach(() => findById.mockReset());

  it('reads the profile by the admin id and returns the trimmed full name', async () => {
    findById.mockResolvedValue({ data: { id: 'a1', full_name: '  Dana Levi ' }, error: null });
    await expect(resolveAdminDisplayName({ id: 'a1', email: 'dana@example.com' })).resolves.toBe('Dana Levi');
    expect(findById).toHaveBeenCalledWith('a1');
  });

  it('no profile row: falls back to the email', async () => {
    findById.mockResolvedValue({ data: null, error: null });
    await expect(resolveAdminDisplayName({ id: 'a1', email: 'dana@example.com' })).resolves.toBe('dana@example.com');
  });

  it('blank full_name: falls back to the email', async () => {
    findById.mockResolvedValue({ data: { id: 'a1', full_name: '   ' }, error: null });
    await expect(resolveAdminDisplayName({ id: 'a1', email: 'dana@example.com' })).resolves.toBe('dana@example.com');
  });

  it('profile read error: still resolves (to the email), does not throw', async () => {
    findById.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(resolveAdminDisplayName({ id: 'a1', email: 'dana@example.com' })).resolves.toBe('dana@example.com');
  });

  it('no name and no email: neutral label', async () => {
    findById.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(resolveAdminDisplayName({ id: 'a1' })).resolves.toBe(ADMIN_NAME_FALLBACK);
  });
});
