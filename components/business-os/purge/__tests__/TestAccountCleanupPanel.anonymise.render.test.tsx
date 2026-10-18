/**
 * @jest-environment jsdom
 *
 * DE-10b.1 (workplan §7.5): the mode choice and the required reason.
 *
 * Pinned: with `lockedEmail` AND `lockedAccountId` the panel offers "Customer
 * account" (close and anonymise, the default) and "Test account" (the hard
 * delete). The anonymise check posts { mode, email, subject } and no tag; its
 * notes render apart from the blockers. Delete stays off until a reason is
 * chosen, and "Other" needs 5 characters, with the no-names hint. The hard
 * mode locks the reason to "Test account" (O-10). The unlocked Danger Zone
 * mount has no anonymise choice.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestAccountCleanupPanel, formatAnonymiseReportText } from '@/components/business-os/purge/TestAccountCleanupPanel';

jest.setTimeout(30_000);

const LOGIN = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'real.owner@example.com';

function checkData(overrides: Record<string, unknown> = {}) {
  return {
    version: 'v1',
    verdict: 'OK',
    targetUserId: LOGIN,
    blockers: [],
    notes: [{ guard: 'G-5', item: 'nothing ever ran in Stripe live mode', found: 2, clears: 'Reported only: billing kept.' }],
    storageObjects: [],
    functionUpToDate: true,
    serverMs: 10,
    rows: [],
    ...overrides,
  };
}

const ANONYMISED = {
  mode: 'anonymise',
  targetUserId: LOGIN,
  filesRemoved: 0,
  receiptId: '99999999-9999-4999-8999-999999999999',
  placeholderRef: '999999999999',
  receiptMode: 'pseudonymised_billing_kept',
  rowsRemoved: 12,
  tablesRemoved: 4,
  rowsBlanked: 3,
  serverMs: { check: 10, delete: 20 },
};

type Call = { url: string; method: string; body: unknown };
type Reply = { status: number; body: unknown };
let calls: Call[] = [];
let replies: { check: Reply; del: Reply };

beforeEach(() => {
  calls = [];
  replies = {
    check: { status: 200, body: { success: true, data: checkData() } },
    del: { status: 200, body: { success: true, data: ANONYMISED } },
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let reply: Reply;
    if (u.endsWith('/check') && method === 'GET') reply = { status: 200, body: { success: true, data: { configured: true } } };
    else if (u.endsWith('/check')) reply = replies.check;
    else if (u.endsWith('/delete')) reply = replies.del;
    else reply = { status: 404, body: {} };
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
});

const posts = (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));

async function ready(props: { lockedAccountId?: string; onRemoved?: jest.Mock } = { lockedAccountId: LOGIN }) {
  const user = userEvent.setup();
  render(<TestAccountCleanupPanel lockedEmail={EMAIL} lockedAccountId={props.lockedAccountId} onRemoved={props.onRemoved} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
  return user;
}

async function checkedAndConfirmed(onRemoved = jest.fn()) {
  const user = await ready({ lockedAccountId: LOGIN, onRemoved });
  await user.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByTestId('cleanup-check-result');
  await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
  return user;
}

describe('the mode choice (locked, with the account id)', () => {
  it('defaults to "Customer account" (close and anonymise), with its warning and no tag field', async () => {
    await ready();
    expect(screen.getByTestId('cleanup-mode-anonymise')).toBeChecked();
    expect(screen.getByTestId('cleanup-mode-hard')).not.toBeChecked();
    expect(screen.getByTestId('cleanup-mode')).toHaveTextContent('Customer account: close and anonymise (keeps our billing)');
    expect(screen.getByTestId('cleanup-mode')).toHaveTextContent('Test account: remove completely');
    expect(screen.getByTestId('cleanup-anonymise-warning')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Tag/)).not.toBeInTheDocument();
  });

  it('the anonymise check posts { mode, email, subject } and no tag; notes render apart from blockers', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(posts('/check')[0].body).toEqual({ mode: 'anonymise', email: EMAIL, subject: LOGIN });
    expect(screen.getByTestId('cleanup-notes')).toHaveTextContent('G-5');
    expect(screen.getByTestId('cleanup-notes')).toHaveTextContent('billing kept');
    expect(screen.queryByTestId('cleanup-blockers')).not.toBeInTheDocument();
  });

  it('"Test account" brings back the hard delete: tag field, locked warning, hard check', async () => {
    const user = await ready();
    await user.click(screen.getByTestId('cleanup-mode-hard'));
    expect(screen.getByLabelText(/^Tag/)).toHaveValue(EMAIL);
    expect(screen.getByTestId('cleanup-locked-warning')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(posts('/check')[0].body).toEqual({ mode: 'hard', email: EMAIL, tag: EMAIL });
  });

  it('without the account id there is no anonymise choice (the hard-only locked mount)', async () => {
    await ready({});
    expect(screen.queryByTestId('cleanup-mode')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Tag/)).toHaveValue(EMAIL);
  });

  it('the unlocked Danger Zone mount has no anonymise choice', async () => {
    render(<TestAccountCleanupPanel />);
    await waitFor(() => expect(screen.getByLabelText(/Email of the test account/)).not.toBeDisabled(), { timeout: 2000 });
    expect(screen.queryByTestId('cleanup-mode')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-anonymise-warning')).not.toBeInTheDocument();
  });
});

describe('the required reason (BQ-4, C-9, O-10)', () => {
  const button = () => screen.getByRole('button', { name: 'Close and anonymise this account' });

  it('no reason chosen: Delete stays disabled', async () => {
    await checkedAndConfirmed();
    expect(button()).toBeDisabled();
  });

  it('"Other" needs at least 5 characters, with the no-names hint', async () => {
    const user = await checkedAndConfirmed();
    await user.click(screen.getByTestId('cleanup-reason-other'));
    expect(screen.getByTestId('cleanup-reason-hint')).toHaveTextContent('Do not write names, emails or client details here.');
    await user.type(screen.getByTestId('cleanup-reason-note'), 'abcd');
    expect(button()).toBeDisabled();
    await user.type(screen.getByTestId('cleanup-reason-note'), 'e');
    expect(button()).not.toBeDisabled();
  });

  it('a chosen reason posts with the delete; the closed report renders and onRemoved waits for Done', async () => {
    const onRemoved = jest.fn();
    const user = await checkedAndConfirmed(onRemoved);
    await user.click(screen.getByTestId('cleanup-reason-customer_asked'));
    await user.click(button());
    const report = await screen.findByTestId('cleanup-anonymised');
    expect(posts('/delete')[0].body).toEqual({
      mode: 'anonymise',
      email: EMAIL,
      subject: LOGIN,
      confirmEmail: EMAIL,
      reason: { category: 'customer_asked' },
    });
    expect(report).toHaveTextContent('Deleted account 999999999999');
    expect(report).toHaveTextContent('Our billing records were kept, with personal details removed.');
    expect(onRemoved).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('cleanup-done'));
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('the hard mode locks the reason to "Test account" and needs no click', async () => {
    const user = await ready();
    await user.click(screen.getByTestId('cleanup-mode-hard'));
    replies.check = { status: 200, body: { success: true, data: checkData({ notes: [] }) } };
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(screen.getByTestId('cleanup-reason-locked')).toHaveTextContent('Test account');
    expect(screen.queryByTestId('cleanup-reason-customer_asked')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    expect(screen.getByRole('button', { name: 'Delete this account' })).not.toBeDisabled();
  });

  it('the copied report holds ids and counts only', () => {
    const text = formatAnonymiseReportText(ANONYMISED as Parameters<typeof formatAnonymiseReportText>[0]);
    expect(text).toContain('Deleted account 999999999999');
    expect(text).not.toContain('@');
  });
});
