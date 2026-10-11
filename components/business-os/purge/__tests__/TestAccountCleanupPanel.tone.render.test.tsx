/**
 * @jest-environment jsdom
 *
 * The admin-dark tone of "Remove this account" (/admin/users).
 *
 * Pinned: the admin page's text is white, so any colour the panel inherits
 * reads as white on white on a light surface. In admin-dark every element
 * carries Tailwind classes with an explicit text colour, nothing keeps an
 * inline light style, the panel has no card of its own, and the locked email
 * is present in its read-only input. Without `tone` the panel keeps its
 * inline light styles (the Danger Zone render test pins that look unmodified).
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';

jest.setTimeout(30_000);

const LOGIN = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'Real.Owner@Example.com';

const CHECK_VIEW = {
  version: 'v1',
  verdict: 'OK',
  targetUserId: LOGIN,
  blockers: [],
  storageObjects: [],
  functionUpToDate: true,
  serverMs: 10,
  rows: [{ section: 'remove', status: 'remove', item: 'B1 business_os_contacts', found: 4, detail: '' }],
};

beforeEach(() => {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const isProbe = String(url).endsWith('/check') && (init?.method ?? 'GET') === 'GET';
    const body = isProbe
      ? { success: true, data: { configured: true } }
      : { success: true, data: CHECK_VIEW };
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
});

async function renderPanel(tone?: 'light' | 'admin-dark') {
  const user = userEvent.setup();
  render(<TestAccountCleanupPanel lockedEmail={EMAIL} tone={tone} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
  return user;
}

const panel = () => screen.getByTestId('test-account-cleanup-panel');

describe('admin-dark tone', () => {
  it('drops the light card and every inline style; the panel sets its own text colour', async () => {
    await renderPanel('admin-dark');
    expect(panel()).not.toHaveAttribute('style');
    expect(panel().querySelectorAll('[style]')).toHaveLength(0);
    expect(panel()).toHaveClass('text-slate-300');
    expect(panel().className).not.toMatch(/bg-white|border-/);
    expect(screen.getByRole('heading', { name: 'Remove this account' })).toHaveClass('text-white', 'font-semibold');
    expect(screen.getByTestId('cleanup-locked-warning')).toHaveClass('text-rose-300');
  });

  it('labels are slate, and the read-only email is present, greyed and readable', async () => {
    await renderPanel('admin-dark');
    const email = screen.getByLabelText(/^Email/) as HTMLInputElement;
    const tag = screen.getByLabelText(/^Tag/) as HTMLInputElement;
    expect(email).toHaveValue(EMAIL);
    expect(tag).toHaveValue(EMAIL);
    for (const input of [email, tag]) {
      expect(input).toHaveAttribute('readonly');
      expect(input).toHaveClass('text-slate-300', 'bg-slate-900/60', 'cursor-not-allowed');
      expect(input.closest('label')).toHaveClass('text-slate-300');
    }
    expect(screen.getByRole('button', { name: 'Check' })).toHaveClass('bg-blue-600', 'text-white', 'rounded-lg');
  });

  it('the check result, confirm input and Delete button use the dark look', async () => {
    const user = await renderPanel('admin-dark');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    const result = await screen.findByTestId('cleanup-check-result');
    expect(result).toHaveClass('bg-slate-800/70', 'border-slate-700', 'rounded-lg');
    expect(screen.getByTestId('cleanup-verdict')).toHaveClass('text-emerald-400');
    expect(screen.getByTestId('cleanup-check-server-time')).toHaveClass('text-slate-500', 'text-xs');
    expect(screen.getByRole('button', { name: 'Copy check result' })).toHaveClass('bg-slate-700', 'text-slate-100');

    const confirm = screen.getByLabelText(/Type the email again/);
    expect(confirm).toHaveClass('bg-slate-800', 'text-white');
    expect(confirm).not.toHaveClass('cursor-not-allowed');
    const del = screen.getByRole('button', { name: 'Delete this account' });
    expect(del).toHaveClass('bg-rose-600', 'text-white', 'opacity-50', 'cursor-not-allowed');
    await user.type(confirm, EMAIL);
    expect(del).toBeEnabled();
    expect(del).toHaveClass('hover:bg-rose-500');
    expect(del).not.toHaveClass('opacity-50');
    expect(panel().querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('default tone', () => {
  it('without `tone` the panel keeps its inline light styles and no Tailwind classes', async () => {
    await renderPanel();
    expect(panel()).toHaveAttribute('style');
    expect(panel()).not.toHaveAttribute('class');
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('style');
    expect(screen.getByRole('heading', { name: 'Remove this account permanently' })).toBeInTheDocument();
  });
});
