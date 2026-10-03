/**
 * @jest-environment jsdom
 *
 * The admin header after the identity change (ADMIN_HEADER_IDENTITY_WORKPLAN).
 *
 * What would mislead if it were wrong: a header that still says "Admin User",
 * a search box that searches nothing, a dropdown that duplicates the sidebar,
 * or a Sign out that does not sign out.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

type SignOutResult = { ok: boolean; error?: string };
const signOutUser = jest.fn<Promise<SignOutResult>, [unknown]>(async () => ({ ok: true }));
jest.mock('@/lib/client/auth-actions', () => ({
  signOutUser: (opts: unknown) => signOutUser(opts),
}));

const sessionUser = { id: 'session-user', email: 'admin@example.com' };
jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: sessionUser }),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin',
}));

jest.mock('@/lib/utils/marketingUrl', () => ({
  marketingLogoutUrl: () => 'https://marketing.example/logout',
}));

jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  const child = () => ({ error: noop, warn: noop, info: noop, debug: noop });
  return { clientLogger: { child } };
});

// The repository is server-only; the fallback chain under test is pure.
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { findById: jest.fn() },
}));

import AdminHeader from '../AdminHeader';
import { ADMIN_NAME_FALLBACK, pickAdminDisplayName } from '../../adminDisplayName';

/** Swap `window.location` for one whose `replace` is a spy, for the duration of `fn`. */
async function withLocationSpy(fn: (replace: jest.Mock) => Promise<void>): Promise<void> {
  const replace = jest.fn();
  const original = window.location;
  Object.defineProperty(window, 'location', { value: { ...original, replace }, writable: true });
  try {
    await fn(replace);
  } finally {
    Object.defineProperty(window, 'location', { value: original, writable: true });
  }
}

describe('AdminHeader', () => {
  beforeEach(() => {
    signOutUser.mockClear();
  });

  it('shows the given admin name, not a hard-coded label', () => {
    render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
    expect(screen.getByTestId('admin-header-name')).toHaveTextContent('Dana Levi');
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
  });

  it('shows the email when that is the resolved display name', () => {
    render(<AdminHeader adminName="ops@example.com" onMenuClick={() => undefined} />);
    expect(screen.getByTestId('admin-header-name')).toHaveTextContent('ops@example.com');
  });

  it('keeps the page title', () => {
    render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Health' })).toBeInTheDocument();
  });

  it('has no search input and no dropdown', () => {
    const { container } = render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    // The dropdown's only items were a Settings link and a dead Sign Out.
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    // Two buttons: the mobile menu toggle and Sign out. Nothing opens a menu.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('Sign out calls the shared signOutUser and leaves through the marketing sign-out', async () => {
    await withLocationSpy(async (replace) => {
      render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith('https://marketing.example/logout'));
      expect(signOutUser).toHaveBeenCalledTimes(1);
      expect(signOutUser).toHaveBeenCalledWith({ scope: 'global', user: sessionUser, method: 'admin-header' });
    });
  });

  it('still leaves when the server sign-out fails (local state is cleared regardless)', async () => {
    signOutUser.mockResolvedValueOnce({ ok: false, error: 'network' });
    await withLocationSpy(async (replace) => {
      render(<AdminHeader adminName="Dana Levi" onMenuClick={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    });
  });
});

describe('pickAdminDisplayName (the layout fallback chain)', () => {
  it('prefers the profile name', () => {
    expect(pickAdminDisplayName('Dana Levi', 'dana@example.com')).toBe('Dana Levi');
  });

  it('falls back to the email when there is no name, or it is blank', () => {
    expect(pickAdminDisplayName(null, 'dana@example.com')).toBe('dana@example.com');
    expect(pickAdminDisplayName('   ', 'dana@example.com')).toBe('dana@example.com');
  });

  it('falls back to a neutral label when there is neither', () => {
    expect(pickAdminDisplayName(null, undefined)).toBe(ADMIN_NAME_FALLBACK);
  });
});
