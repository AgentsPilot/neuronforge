/**
 * @jest-environment jsdom
 *
 * Locked mode of "Remove a test account" (AU-1, /admin/users; SA AU-C1, AU-C6).
 *
 * Pinned: the email and the tag are pre-filled with the row's email and are
 * read-only; the fixed warning line shows and no "test account" / "must
 * contain the tag" copy does; the check posts { email, tag: email }; the typed
 * confirmation is still required; after a CLEAN report the report stays, with
 * a Done button, and `onRemoved` fires once on Done (or on unmount), never on
 * a non-CLEAN result or a refusal. The Danger Zone (no props) is pinned, unmodified, in
 * TestAccountCleanupPanel.render.test.tsx.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LOCKED_WARNING, TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';

jest.setTimeout(30_000);

const LOGIN = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'Real.Owner@Example.com';

function checkData(overrides: Record<string, unknown> = {}) {
  return {
    version: 'v1',
    verdict: 'OK',
    targetUserId: LOGIN,
    blockers: [],
    storageObjects: [],
    functionUpToDate: true,
    serverMs: 10,
    rows: [{ section: 'remove', status: 'remove', item: 'B1 business_os_contacts', found: 4, detail: '' }],
    ...overrides,
  };
}

function deleteData(result: string) {
  return {
    targetUserId: LOGIN,
    filesRemoved: 0,
    report: {
      tables: [{ table: 'auth.users', rowsRemoved: 1 }],
      total: { result, rowsRemoved: 1, tablesRemoved: 1, removedLogin: LOGIN, removedAt: null, sameRun: true },
    },
    serverMs: { check: 10, delete: 20 },
  };
}

type Call = { url: string; method: string; body: unknown };
type Reply = { status: number; body: unknown };
let calls: Call[] = [];
let replies: { probe: Reply; check: Reply; del: Reply };

beforeEach(() => {
  calls = [];
  replies = {
    probe: { status: 200, body: { success: true, data: { configured: true } } },
    check: { status: 200, body: { success: true, data: checkData() } },
    del: { status: 200, body: { success: true, data: deleteData('CLEAN') } },
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let reply: Reply;
    if (u.endsWith('/check') && method === 'GET') reply = replies.probe;
    else if (u.endsWith('/check')) reply = replies.check;
    else if (u.endsWith('/delete')) reply = replies.del;
    else reply = { status: 404, body: {} };
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
});

const posts = (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));

async function ready(onRemoved = jest.fn()) {
  const user = userEvent.setup();
  render(<TestAccountCleanupPanel lockedEmail={EMAIL} onRemoved={onRemoved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
  return user;
}

async function checkedAndConfirmed(onRemoved: jest.Mock) {
  const user = await ready(onRemoved);
  await user.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByTestId('cleanup-check-result');
  await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
  return user;
}

describe('locked mode (AU-1)', () => {
  it('pre-fills the email and the tag with the row email, read-only and not editable', async () => {
    const user = await ready();
    const email = screen.getByLabelText(/^Email/) as HTMLInputElement;
    const tag = screen.getByLabelText(/^Tag/) as HTMLInputElement;
    expect(email).toHaveValue(EMAIL);
    expect(tag).toHaveValue(EMAIL);
    expect(email).toHaveAttribute('readonly');
    expect(tag).toHaveAttribute('readonly');
    await user.type(email, 'x');
    await user.type(tag, 'x');
    expect(email).toHaveValue(EMAIL);
    expect(tag).toHaveValue(EMAIL);
  });

  it('shows the fixed warning line, and no test-account or tag-rule copy', async () => {
    await ready();
    expect(screen.getByTestId('cleanup-locked-warning')).toHaveTextContent(
      'Permanently removes a real account, its login and money history.'
    );
    expect(LOCKED_WARNING).toBe('Permanently removes a real account, its login and money history.');
    const panel = screen.getByTestId('test-account-cleanup-panel');
    expect(panel).not.toHaveTextContent(/test account/i);
    expect(panel).not.toHaveTextContent(/must contain/i);
    expect(screen.queryByTestId('cleanup-empty-tag-hint')).not.toBeInTheDocument();
  });

  it('the check posts { email, tag: email }', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(posts('/check')).toHaveLength(1);
    expect(posts('/check')[0].body).toEqual({ email: EMAIL, tag: EMAIL });
  });

  it('keeps the typed confirmation: Delete stays off until the email is typed again', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    const del = screen.getByRole('button', { name: 'Delete this account' });
    expect(del).toBeDisabled();
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL.toLowerCase());
    expect(del).not.toBeDisabled();
  });

  it('a CLEAN delete posts { email, tag: email, confirmEmail }; the report stays and onRemoved waits for Done', async () => {
    const onRemoved = jest.fn();
    const user = await checkedAndConfirmed(onRemoved);
    await user.click(screen.getByRole('button', { name: 'Delete this account' }));
    await screen.findByTestId('cleanup-report');
    expect(posts('/delete')[0].body).toEqual({ email: EMAIL, tag: EMAIL, confirmEmail: EMAIL });
    expect(screen.getByTestId('cleanup-report')).toHaveTextContent('Account removed.');
    expect(screen.getByTestId('cleanup-copy-report')).not.toBeDisabled();
    expect(onRemoved).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('cleanup-done'));
    expect(onRemoved).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('cleanup-done'));
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('unmounting after a CLEAN result without Done still calls onRemoved, once', async () => {
    const onRemoved = jest.fn();
    const user = userEvent.setup();
    const { unmount } = render(<TestAccountCleanupPanel lockedEmail={EMAIL} onRemoved={onRemoved} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Delete this account' }));
    await screen.findByTestId('cleanup-report');
    expect(onRemoved).not.toHaveBeenCalled();
    unmount();
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('unmounting without a CLEAN result does not call onRemoved', async () => {
    const onRemoved = jest.fn();
    const { unmount } = render(<TestAccountCleanupPanel lockedEmail={EMAIL} onRemoved={onRemoved} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
    unmount();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('a delete whose report is not CLEAN does not call onRemoved', async () => {
    replies.del = { status: 200, body: { success: true, data: deleteData('SURVIVORS') } };
    const onRemoved = jest.fn();
    const user = await checkedAndConfirmed(onRemoved);
    await user.click(screen.getByRole('button', { name: 'Delete this account' }));
    await screen.findByTestId('cleanup-report');
    expect(screen.queryByTestId('cleanup-done')).not.toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('a refused delete (BLOCKED) does not call onRemoved and leaves the email in place', async () => {
    replies.del = {
      status: 409,
      body: { success: false, error: 'blocked', guards: ['G-5'], blockers: [{ guard: 'G-5', item: 'live Stripe', found: 1, clears: '' }] },
    };
    const onRemoved = jest.fn();
    const user = await checkedAndConfirmed(onRemoved);
    await user.click(screen.getByRole('button', { name: 'Delete this account' }));
    expect(await screen.findByTestId('cleanup-delete-error')).toHaveTextContent('BLOCKED by G-5, nothing was removed.');
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Email/)).toHaveValue(EMAIL);
  });

  it('a BLOCKED check offers no delete and does not call onRemoved', async () => {
    replies.check = {
      status: 200,
      body: { success: true, data: checkData({ verdict: 'BLOCKED', blockers: [{ guard: 'G-4', item: 'target is an admin', found: 1, clears: '' }] }) },
    };
    const onRemoved = jest.fn();
    const user = await ready(onRemoved);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(screen.getByTestId('cleanup-verdict')).toHaveTextContent('BLOCKED');
    expect(screen.queryByRole('button', { name: 'Delete this account' })).not.toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
