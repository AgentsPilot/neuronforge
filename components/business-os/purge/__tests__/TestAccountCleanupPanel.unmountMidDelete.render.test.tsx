/**
 * @jest-environment jsdom
 *
 * LF-F1 (requirement ADMIN_LAYOUT_FOLLOWUPS §14 LF4A1-F1): a delete answer
 * that lands after the panel has unmounted.
 *
 * Pinned, for both callers (locked mode as on /admin/users, and the Danger
 * Zone with no lockedEmail): a CLEAN answer after unmount calls onRemoved
 * exactly once; a not-CLEAN answer, a refusal or a network error after
 * unmount calls nothing. Locked mode inside React.StrictMode (SA F1): a CLEAN
 * on a live panel still waits for Done, and unmount before CLEAN still calls
 * once. The other mounted paths are pinned in
 * TestAccountCleanupPanel.locked.render.test.tsx and stay unchanged.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';

jest.setTimeout(30_000);

const LOGIN = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'qa+cleanup-test@example.com';

const CHECK_DATA = {
  version: 'v1',
  verdict: 'OK',
  targetUserId: LOGIN,
  blockers: [],
  storageObjects: [],
  functionUpToDate: true,
  serverMs: 10,
  rows: [{ section: 'remove', status: 'remove', item: 'B1 business_os_contacts', found: 4, detail: '' }],
};

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

type Reply = { status: number; body: unknown };
/** The held delete: resolves with a reply, or rejects for a network error. */
let held: { resolve: (reply: Reply) => void; reject: (err: Error) => void } | null = null;

beforeEach(() => {
  held = null;
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const answer = (reply: Reply) =>
      ({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body }) as Response;
    if (u.endsWith('/check') && method === 'GET') {
      return Promise.resolve(answer({ status: 200, body: { success: true, data: { configured: true } } }));
    }
    if (u.endsWith('/check')) return Promise.resolve(answer({ status: 200, body: { success: true, data: CHECK_DATA } }));
    if (u.endsWith('/delete')) {
      return new Promise<Response>((resolve, reject) => {
        held = { resolve: (reply) => resolve(answer(reply)), reject };
      });
    }
    return Promise.resolve(answer({ status: 404, body: {} }));
  }) as unknown as typeof fetch;
});

type Mode = 'locked' | 'danger zone';
const MODES: Mode[] = ['locked', 'danger zone'];

/** Check, confirm, click Delete; the answer is held. `strict` renders inside React.StrictMode (the App Router does in dev). */
async function startDelete(mode: Mode, onRemoved: jest.Mock, strict = false) {
  const user = userEvent.setup();
  const panel =
    mode === 'locked' ? (
      <TestAccountCleanupPanel lockedEmail={EMAIL} onRemoved={onRemoved} />
    ) : (
      <TestAccountCleanupPanel onRemoved={onRemoved} />
    );
  const view = render(strict ? <React.StrictMode>{panel}</React.StrictMode> : panel);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument(), { timeout: 2000 });
  if (mode === 'danger zone') {
    const field = screen.getByLabelText(/Email of the test account/);
    await waitFor(() => expect(field).not.toBeDisabled(), { timeout: 2000 });
    await user.type(field, EMAIL);
  }
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check' })).not.toBeDisabled(), { timeout: 2000 });
  await user.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByTestId('cleanup-check-result');
  await user.type(screen.getByLabelText(/Type the email again/), EMAIL);
  await user.click(screen.getByRole('button', { name: mode === 'locked' ? 'Delete this account' : 'Delete this test account' }));
  await waitFor(() => expect(held).not.toBeNull());
  return { user, view };
}

/** Check, confirm, click Delete (held), then unmount before the answer lands. */
async function unmountMidDelete(mode: Mode, onRemoved: jest.Mock, strict = false) {
  const { view } = await startDelete(mode, onRemoved, strict);
  view.unmount();
  expect(onRemoved).not.toHaveBeenCalled();
}

async function land(reply: Reply | Error) {
  const h = held;
  if (h === null) throw new Error('no delete in flight');
  await act(async () => {
    if (reply instanceof Error) h.reject(reply);
    else h.resolve(reply);
    // Let the answer's json() and the rest of runDelete finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe.each(MODES)('LF-F1, %s: the delete answer lands after unmount', (mode) => {
  it('a CLEAN answer calls onRemoved exactly once', async () => {
    const onRemoved = jest.fn();
    await unmountMidDelete(mode, onRemoved);
    await land({ status: 200, body: { success: true, data: deleteData('CLEAN') } });
    expect(onRemoved).toHaveBeenCalledTimes(1);
    // Nothing later adds a second call.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('a not-CLEAN answer calls nothing', async () => {
    const onRemoved = jest.fn();
    await unmountMidDelete(mode, onRemoved);
    await land({ status: 200, body: { success: true, data: deleteData('SURVIVORS') } });
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('a refused answer calls nothing', async () => {
    const onRemoved = jest.fn();
    await unmountMidDelete(mode, onRemoved);
    await land({ status: 409, body: { success: false, error: 'blocked', guards: ['G-5'], blockers: [] } });
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('a network error calls nothing', async () => {
    const onRemoved = jest.fn();
    await unmountMidDelete(mode, onRemoved);
    await land(new Error('network down'));
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

// SA F1 on LF-F1: StrictMode mounts, unmounts and re-mounts every effect once.
// The re-mount must set `mounted` again, or a CLEAN on a live panel would be
// reported at once instead of waiting for Done (SA mutation S1).
describe('LF-F1, locked, inside React.StrictMode', () => {
  const CLEAN: Reply = { status: 200, body: { success: true, data: deleteData('CLEAN') } };

  it('CLEAN on a live panel: no call before Done, Done calls once, a later unmount adds none', async () => {
    const onRemoved = jest.fn();
    const { user, view } = await startDelete('locked', onRemoved, true);
    await land(CLEAN);
    await screen.findByTestId('cleanup-report');
    expect(onRemoved).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('cleanup-done'));
    expect(onRemoved).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('unmount before CLEAN: exactly one call', async () => {
    const onRemoved = jest.fn();
    await unmountMidDelete('locked', onRemoved, true);
    await land(CLEAN);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });
});
