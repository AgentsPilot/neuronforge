/**
 * @jest-environment jsdom
 *
 * "Remove a test account" in the Danger Zone (test-account cleanup, slice 2).
 *
 * Pinned: absent for a non-admin (PurgeDangerZone access denied, and the
 * panel's own probe answering 403); "not set up" disables the actions; the
 * check renders OK / BLOCKED with blockers and their clearing actions, rows,
 * files and what is kept; the delete is offered only after OK or G-12-only,
 * and enabled only on a matching typed email; the exact POST bodies; one
 * request per double click; the report with TOTAL; refusals as one plain
 * sentence, never the server's message or details; and the component imports
 * no server module.
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';
import { PurgeDangerZone } from '@/components/business-os/purge/PurgeDangerZone';

jest.setTimeout(30_000);

const LOGIN = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'qa+test@example.com';
const SERVER_SECRET_TEXT = 'SERVER-RAW-TEXT pg detail relation does not exist';

function checkData(overrides: Record<string, unknown> = {}) {
  return {
    version: 'v1',
    verdict: 'OK',
    targetUserId: LOGIN,
    blockers: [],
    storageObjects: [],
    functionUpToDate: true,
    rows: [
      { section: 'VERDICT', status: 'OK', item: `login ${LOGIN}`, found: 0, detail: 'Run the delete file next.' },
      { section: 'remove', status: 'remove', item: 'B1 business_os_contacts', found: 4, detail: '' },
      { section: 'remove', status: 'unknown', item: 'B2 business_os_notes', found: null, detail: '' },
      { section: 'trigger', status: 'info', item: 'auth.users.on_auth_user_created', found: null, detail: 'Fires when the login is deleted.' },
      { section: 'kept', status: 'kept', item: 'business_os_invites redeemed or claimed by it', found: 1, detail: 'The invite history stays.' },
    ],
    ...overrides,
  };
}

const deleteData = {
  targetUserId: LOGIN,
  filesRemoved: 2,
  report: {
    tables: [
      { table: 'business_os_contacts', rowsRemoved: 4 },
      { table: 'auth.users', rowsRemoved: 1 },
    ],
    total: { result: 'CLEAN', rowsRemoved: 5, tablesRemoved: 2, removedLogin: LOGIN, removedAt: '2026-10-07T10:00:00Z', sameRun: true },
  },
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
type Reply = { status: number; body: unknown };
let replies: { probe: Reply; check: Reply; del: Reply; access: Reply };
let holdDelete: Promise<void> | null = null;

beforeEach(() => {
  calls = [];
  holdDelete = null;
  replies = {
    access: { status: 200, body: { success: true, data: { allowed: true, reason: 'admin', userId: 'admin-1', email: 'admin@x', resetLive: false } } },
    probe: { status: 200, body: { success: true, data: { configured: true } } },
    check: { status: 200, body: { success: true, data: checkData() } },
    del: { status: 200, body: { success: true, data: deleteData } },
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let reply: Reply;
    if (u.includes('/purge/access')) reply = replies.access;
    else if (u.endsWith('/check') && method === 'GET') reply = replies.probe;
    else if (u.endsWith('/check')) reply = replies.check;
    else if (u.endsWith('/delete')) {
      if (holdDelete) await holdDelete;
      reply = replies.del;
    } else reply = { status: 404, body: {} };
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
});

const posts = (suffix: string) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(suffix));

async function ready(onLog?: jest.Mock) {
  const user = userEvent.setup();
  render(<TestAccountCleanupPanel onLog={onLog} />);
  // Fails the test on its own timeout: a probe that never resolves must not pass
  // silently. The inputs enable once the probe says configured (Check itself
  // also waits for an email).
  await waitFor(() => expect(screen.getByLabelText(/Email of the test account/)).not.toBeDisabled(), { timeout: 2000 });
  return user;
}

async function checked(email = EMAIL, onLog?: jest.Mock) {
  const user = await ready(onLog);
  await user.type(screen.getByLabelText(/Email of the test account/), email);
  await user.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByTestId('cleanup-check-result');
  return user;
}

describe('visibility', () => {
  it('PurgeDangerZone renders no cleanup section and makes no probe for a non-admin', async () => {
    replies.access = { status: 200, body: { success: true, data: { allowed: false, reason: 'not_admin' } } };
    render(<PurgeDangerZone />);
    await screen.findByText(/Not available/);
    expect(screen.queryByText('Remove a test account')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('test-account-cleanup'))).toBe(false);
  });

  it('PurgeDangerZone mounts the section for an admin', async () => {
    render(<PurgeDangerZone />);
    expect(await screen.findByRole('heading', { name: 'Remove a test account' })).toBeInTheDocument();
  });

  it.each([401, 403])('the panel renders nothing when its own probe answers %s', async (status) => {
    replies.probe = { status, body: { success: false, error: 'Forbidden' } };
    const { container } = render(<TestAccountCleanupPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('not configured', () => {
  it('says so with a pointer to runbook section 6, and disables the actions', async () => {
    replies.probe = { status: 200, body: { success: true, data: { configured: false } } };
    render(<TestAccountCleanupPanel />);
    const note = await screen.findByTestId('cleanup-not-configured');
    expect(note).toHaveTextContent('Not set up on this deployment');
    expect(note).toHaveTextContent(/section 6/);
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    expect(screen.getByLabelText(/Email of the test account/)).toBeDisabled();
  });
});

describe('the check', () => {
  it('posts { email, tag } with the default +test tag, trimmed', async () => {
    await checked(`  ${EMAIL}  `);
    expect(posts('/check')).toHaveLength(1);
    expect(posts('/check')[0].body).toEqual({ email: EMAIL, tag: '+test' });
  });

  it('refuses to run with an empty tag, but accepts any other tag', async () => {
    const user = await ready();
    await user.type(screen.getByLabelText(/Email of the test account/), 'a@walla.co.il');
    const tagInput = screen.getByLabelText(/Test tag/);
    await user.clear(tagInput);
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    await user.type(tagInput, '@walla.co.il');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('cleanup-check-result');
    expect(posts('/check')[0].body).toEqual({ email: 'a@walla.co.il', tag: '@walla.co.il' });
  });

  it('OK: verdict, rows (unknown not 0), triggers, kept; the confirm field appears', async () => {
    await checked();
    const result = screen.getByTestId('cleanup-check-result');
    expect(screen.getByTestId('cleanup-verdict')).toHaveTextContent('OK');
    expect(result).toHaveTextContent(LOGIN);
    const rows = screen.getByTestId('cleanup-remove-rows');
    expect(rows).toHaveTextContent('B1 business_os_contacts4');
    expect(rows).toHaveTextContent('B2 business_os_notesunknown');
    expect(result).toHaveTextContent('auth.users.on_auth_user_created — Fires when the login is deleted.');
    expect(screen.queryByTestId('cleanup-other-rows')).not.toBeInTheDocument();
    expect(screen.getByTestId('cleanup-kept')).toHaveTextContent('The invite history stays.');
    // The pasted-SQL instruction is not shown on the page.
    expect(result).not.toHaveTextContent('Run the delete file next');
    expect(screen.getByTestId('cleanup-confirm')).toBeInTheDocument();
  });

  it('BLOCKED: every blocker with its clearing action, and no delete offered', async () => {
    replies.check = {
      status: 200,
      body: {
        success: true,
        data: checkData({
          verdict: 'BLOCKED',
          blockers: [
            { guard: 'G-5', item: 'is a platform admin', found: 1, clears: 'Remove the admin_users row first.' },
            { guard: 'G-9', item: 'real payments', found: 2, clears: 'Refund or keep the account.' },
          ],
        }),
      },
    };
    await checked();
    expect(screen.getByTestId('cleanup-verdict')).toHaveTextContent('BLOCKED');
    const list = screen.getByTestId('cleanup-blockers');
    expect(list).toHaveTextContent('G-5 is a platform admin (1) — to clear: Remove the admin_users row first.');
    expect(list).toHaveTextContent('G-9 real payments (2) — to clear: Refund or keep the account.');
    expect(screen.queryByTestId('cleanup-confirm')).not.toBeInTheDocument();
  });

  it('BLOCKED by G-12 only: lists the files and still offers the delete', async () => {
    replies.check = {
      status: 200,
      body: {
        success: true,
        data: checkData({
          verdict: 'BLOCKED',
          blockers: [{ guard: 'G-12', item: 'files in storage', found: 2, clears: 'Empty the folder.' }],
          storageObjects: [
            { bucket: 'business-assets', path: `${LOGIN}/logo.png` },
            { bucket: 'business-assets', path: `${LOGIN}/hero.jpg` },
          ],
        }),
      },
    };
    await checked();
    expect(screen.getByTestId('cleanup-blockers')).toHaveTextContent('the delete removes these files first');
    expect(screen.getByTestId('cleanup-storage')).toHaveTextContent(`business-assets/${LOGIN}/logo.png`);
    expect(screen.getByTestId('cleanup-confirm')).toBeInTheDocument();
  });

  it('BLOCKED with no listed blocker: no delete offered', async () => {
    replies.check = { status: 200, body: { success: true, data: checkData({ verdict: 'BLOCKED', blockers: [] }) } };
    await checked();
    expect(screen.getByTestId('cleanup-verdict')).toHaveTextContent('BLOCKED');
    expect(screen.queryByTestId('cleanup-confirm')).not.toBeInTheDocument();
  });

  it('a section this build does not know is listed, not dropped', async () => {
    const base = checkData();
    replies.check = {
      status: 200,
      body: {
        success: true,
        data: { ...base, rows: [...base.rows, { section: 'policy', status: 'info', item: 'new row kind', found: 3, detail: 'explained' }] },
      },
    };
    await checked();
    expect(screen.getByTestId('cleanup-other-rows')).toHaveTextContent('policy · info · new row kind (3) — explained');
  });

  it('a network error on the check reads as one sentence', async () => {
    const user = await ready();
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await user.type(screen.getByLabelText(/Email of the test account/), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByTestId('cleanup-check-error')).toHaveTextContent('Could not reach the server. Nothing was changed.');
  });

  it('a network error on the probe: "could not tell", actions disabled', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    render(<TestAccountCleanupPanel />);
    expect(await screen.findByText(/Could not tell whether this is set up/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });

  it('an out-of-date function: no delete offered', async () => {
    replies.check = { status: 200, body: { success: true, data: checkData({ functionUpToDate: false }) } };
    await checked();
    expect(screen.getByTestId('cleanup-check-result')).toHaveTextContent('out of date');
    expect(screen.queryByTestId('cleanup-confirm')).not.toBeInTheDocument();
  });

  it('editing the email throws the check away', async () => {
    const user = await checked();
    await user.type(screen.getByLabelText(/Email of the test account/), 'x');
    expect(screen.queryByTestId('cleanup-check-result')).not.toBeInTheDocument();
  });

  it.each([
    [503, 'not_configured', 'Not set up on this deployment. Nothing was changed.'],
    [503, 'function_missing', 'The cleanup is not available on this deployment. Nothing was changed.'],
    [400, 'invalid_body', 'Enter a valid email and a tag.'],
    [500, 'check_failed', 'The check could not run. Nothing was changed.'],
  ])('a %s %s reads as one plain sentence, never the server text', async (status, error, sentence) => {
    replies.check = { status, body: { success: false, error, message: SERVER_SECRET_TEXT, details: SERVER_SECRET_TEXT } };
    const user = await ready();
    await user.type(screen.getByLabelText(/Email of the test account/), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByTestId('cleanup-check-error')).toHaveTextContent(sentence);
    expect(document.body).not.toHaveTextContent(SERVER_SECRET_TEXT);
  });
});

describe('confirm and delete', () => {
  it('Delete is enabled only on a matching (trimmed, case-insensitive) email', async () => {
    const user = await checked();
    const confirm = screen.getByLabelText(/Type the email again/);
    const del = screen.getByRole('button', { name: 'Delete this test account' });
    expect(del).toBeDisabled();
    await user.type(confirm, 'qa+test@example.co');
    expect(del).toBeDisabled();
    await user.type(confirm, 'M ');
    expect(del).not.toBeDisabled();
  });

  it('posts { email, tag, confirmEmail } once, shows Deleting…, then the report', async () => {
    let release: () => void = () => undefined;
    holdDelete = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = await checked();
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    const del = screen.getByRole('button', { name: 'Delete this test account' });
    await user.dblClick(del);
    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    release();
    const report = await screen.findByTestId('cleanup-report');

    expect(posts('/delete')).toHaveLength(1);
    expect(posts('/delete')[0].body).toEqual({ email: EMAIL, tag: '+test', confirmEmail: EMAIL });

    const rows = within(report).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('business_os_contacts4');
    expect(screen.getByTestId('cleanup-report-total')).toHaveTextContent('TOTAL · CLEAN5 rows in 2 tables');
    expect(report).toHaveTextContent('Files removed: 2');
    expect(report).toHaveTextContent(LOGIN);
    // The check described an account that is gone.
    expect(screen.queryByTestId('cleanup-check-result')).not.toBeInTheDocument();
  });

  it('a network error on the delete reads as one sentence', async () => {
    const user = await checked();
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await user.click(screen.getByRole('button', { name: 'Delete this test account' }));
    expect(await screen.findByTestId('cleanup-delete-error')).toHaveTextContent(
      'The request did not complete. Run the check again to see what is left.'
    );
  });

  it('never writes the email or the tag to the debug console', async () => {
    const onLog = jest.fn();
    const user = await checked(EMAIL, onLog);
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Delete this test account' }));
    await screen.findByTestId('cleanup-report');
    expect(onLog).toHaveBeenCalled();
    const logged = JSON.stringify(onLog.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('+test');
  });

  it.each([
    [{ status: 409, body: { error: 'blocked', guards: ['G-7'], filesRemoved: 0 } }, 'BLOCKED by G-7, nothing was removed.'],
    [{ status: 409, body: { error: 'blocked', guards: ['G-7'], filesRemoved: 2 } }, 'Files removed, account kept: blocked by G-7.'],
    [{ status: 400, body: { error: 'confirmation_mismatch', guards: ['G-3'] } }, 'The confirmation does not equal the email. Nothing was removed.'],
    [{ status: 503, body: { error: 'not_configured' } }, 'Not set up on this deployment. Nothing was removed.'],
    [{ status: 503, body: { error: 'function_out_of_date', filesRemoved: 0 } }, 'The database function is out of date. Apply the current migration. Nothing was removed.'],
    [{ status: 503, body: { error: 'not_authorised', filesRemoved: 3 } }, 'The cleanup is not available on this deployment. Files removed, account kept.'],
    [{ status: 500, body: { error: 'storage_failed', filesRemoved: 0 } }, 'The storage step failed, so some files may be gone. The account was kept. Run the check again.'],
    [{ status: 500, body: { error: 'delete_failed', filesRemoved: 1 } }, 'Files removed, account kept: the delete did not run to the end.'],
    [{ status: 500, body: { error: 'Internal server error' } }, 'The removal stopped unexpectedly. Run the check again before retrying.'],
  ])('refusal %j reads as one plain sentence, never the server text', async (reply, sentence) => {
    replies.del = { status: reply.status, body: { success: false, message: SERVER_SECRET_TEXT, details: SERVER_SECRET_TEXT, ...reply.body } };
    const user = await checked();
    await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Delete this test account' }));
    expect(await screen.findByTestId('cleanup-delete-error')).toHaveTextContent(sentence);
    expect(document.body).not.toHaveTextContent(SERVER_SECRET_TEXT);
    expect(screen.queryByTestId('cleanup-report')).not.toBeInTheDocument();
  });
});

describe('source guard', () => {
  const src = readFileSync(join(__dirname, '..', 'TestAccountCleanupPanel.tsx'), 'utf-8');
  const types = readFileSync(join(__dirname, '..', '..', '..', '..', 'lib', 'business-os', 'test-account-cleanup', 'cleanupApiTypes.ts'), 'utf-8');

  it('is a client component', () => {
    expect(src.startsWith("'use client'")).toBe(true);
  });

  it('imports no server module (repositories, server-only, supabase, logger, lib/server)', () => {
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).not.toMatch(/lib\/repositories|server-only|supabase|lib\/server|lib\/logger|runCleanupDelete|cleanupFunctionVersion/);
    }
    expect(imports.filter((spec) => spec.startsWith('@/'))).toEqual(['@/lib/business-os/test-account-cleanup/cleanupApiTypes']);
  });

  it('its types file imports nothing', () => {
    expect(types).not.toMatch(/^\s*import\s/m);
  });

  it('never renders the server message or details', () => {
    expect(src).not.toMatch(/\.message\b/);
    expect(src).not.toMatch(/\.details\b/);
  });
});
