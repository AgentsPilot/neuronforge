/**
 * @jest-environment jsdom
 */

/**
 * The read-only "Delete…" dialog (admin delete AD-1c; requirement FR-A2,
 * FR-A3, AC-A2 / AC-A3 rendered half; SA SC-9, SC-12).
 *
 * Fetch is stubbed per test. The payloads are shaped like the AD-1b route's
 * `data` (`DeletionPreviewPayload`).
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DeleteBusinessDialog } from '../components/DeleteBusinessDialog';
import {
  DELETION_COMMIT_UNKNOWN,
  DELETION_COPY,
  DELETION_GENERIC_ERROR,
  DELETION_KEPT_CATEGORIES,
  DELETION_RESULT_KEPT,
  DELETION_STATUS_LABELS,
} from '../deletionCopy';
import type { DeletionCommitResultView, DeletionPreviewPayload, DeletionRefusalView } from '../types';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PREVIEW_URL = `/api/admin/users/${ACCOUNT}/deletion/preview`;
const R3_CLEARING =
  'Cancel the subscription in the Stripe dashboard, in the mode shown (test or live). In-app cancel arrives with plan payments P-7a.';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

function refusals(overrides: Partial<Record<DeletionRefusalView['id'], Partial<DeletionRefusalView>>> = {}): DeletionRefusalView[] {
  const base: DeletionRefusalView[] = [
    { id: 'R-1', status: 'clear', message: 'This is not your own account.' },
    { id: 'R-2', status: 'clear', message: 'This account is not a platform admin.' },
    { id: 'R-3', status: 'clear', message: 'No live platform plan subscription, in test or live mode.' },
    { id: 'R-4', status: 'not_applicable', message: 'No cross-account payment relationship exists.' },
    { id: 'R-5', status: 'clear', message: 'No Stripe account connected.' },
    { id: 'R-6', status: 'clear', message: 'No money in flight.' },
    { id: 'R-7', status: 'deferred', message: 'Checked at the moment of deletion.' },
    { id: 'R-8', status: 'clear', message: 'Every table that holds business data is classified.' },
  ];
  return base.map((r) => ({ ...r, ...overrides[r.id] }));
}

function payload(overrides: Partial<DeletionPreviewPayload> = {}): DeletionPreviewPayload {
  return {
    target: { userId: ACCOUNT, email: 'owner@example.com', businessName: 'Acme Therapy', joinedAt: '2026-03-05T10:00:00.000Z' },
    counted: true,
    level: 'purge',
    options: { integrations: true, agents: false, activityHistory: false },
    areas: [
      {
        area: 'crm',
        rows: 1234,
        tablesUnknown: 0,
        tables: [
          { table: 'contacts', count: 1200 },
          { table: 'leads', count: 34 },
        ],
      },
      {
        area: 'scheduling',
        rows: 0,
        tablesUnknown: 1,
        tables: [{ table: 'bookings', count: null, error: 'permission denied for table bookings' }],
      },
    ],
    storage: [{ table: 'website-images', count: 7 }],
    totals: { rows: 1234, tablesWithRows: 2, tablesUnknown: 1 },
    keptTables: [{ table: 'email_unsubscribes', notes: 'A withdrawal must outlive the business.' }],
    refusals: refusals(),
    schema: { status: 'ok', unclassified: [], missingDeletable: [], missingNever: [], fingerprint: 'abc' },
    resetLive: false,
    limitations: ['1 table(s) could not be counted: shown as "unknown", not as zero.'],
    deletionAvailable: false,
    commitToken: null,
    confirmKind: 'business name',
    deletionUnavailableReason: 'deleting a business ships in a later release (the Purge level and the key rotation are not done)',
    correlationId: 'corr-123',
    generatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

type Reply = { status: number; body: unknown } | 'network_error' | 'pending';

function stubFetch(reply: Reply) {
  const fetchMock = jest.fn<Promise<unknown>, [url: string, init?: { method?: string; body?: string }]>(async () => {
    if (reply === 'network_error') throw new TypeError('Failed to fetch');
    if (reply === 'pending') return new Promise<never>(() => undefined);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

async function openDialog(reply: Reply) {
  const fetchMock = stubFetch(reply);
  await act(async () => {
    render(<DeleteBusinessDialog open onOpenChange={() => undefined} accountId={ACCOUNT} />);
  });
  return fetchMock;
}

const ok = (data: DeletionPreviewPayload) => ({ status: 200, body: { success: true, data } });

describe('DeleteBusinessDialog', () => {
  it('opening POSTs {} once to the preview route, and nothing else', async () => {
    const fetchMock = await openDialog(ok(payload()));
    await screen.findByTestId('deletion-refusals');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PREVIEW_URL);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
  });

  it('a closed dialog fetches nothing', async () => {
    const fetchMock = stubFetch(ok(payload()));
    await act(async () => {
      render(<DeleteBusinessDialog open={false} onOpenChange={() => undefined} accountId={ACCOUNT} />);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loading: the status region says so, and the confirm button is disabled', async () => {
    await openDialog('pending');
    expect(screen.getByTestId('deletion-status')).toHaveTextContent('Loading the deletion preview');
    expect(screen.getByTestId('deletion-status')).toHaveTextContent('Deletion not yet available: the preview has not loaded yet.');
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
    expect(screen.getByTestId('deletion-confirm')).toHaveAttribute('aria-describedby', screen.getByTestId('deletion-status').id);
    expect(screen.queryByTestId('deletion-refusals')).toBeNull();
  });

  it('shows the target: business name, email, user id, joined date', async () => {
    await openDialog(ok(payload()));
    const target = await screen.findByTestId('deletion-target');
    expect(target).toHaveTextContent('Acme Therapy');
    expect(target).toHaveTextContent('owner@example.com');
    expect(target).toHaveTextContent(ACCOUNT);
    expect(target).toHaveTextContent('2026-03-05');
  });

  it('per-area counts in plain language; an uncounted table is "unknown", never 0; storage counted', async () => {
    await openDialog(ok(payload()));
    expect(await screen.findByTestId('area-crm')).toHaveTextContent('Contacts, leads and proposals');
    expect(screen.getByTestId('area-crm')).toHaveTextContent('1,234 rows');
    const scheduling = screen.getByTestId('area-scheduling');
    expect(scheduling).toHaveTextContent('unknown');
    expect(scheduling).not.toHaveTextContent(/\b0 rows\b/);
    expect(screen.getByTestId('storage-website-images')).toHaveTextContent('7');
    // The server's count error is never rendered: only "unknown".
    expect(document.body).not.toHaveTextContent('permission denied');
  });

  it('the technical expander lists the tables, and the kept list explains why', async () => {
    await openDialog(ok(payload()));
    const technical = await screen.findByTestId('deletion-technical');
    expect(technical.tagName).toBe('DETAILS');
    expect(technical).toHaveTextContent('contacts: 1,200');
    expect(technical).toHaveTextContent('bookings: unknown');
    expect(technical).toHaveTextContent('email_unsubscribes');
    const kept = screen.getByTestId('deletion-kept');
    for (const category of DELETION_KEPT_CATEGORIES) expect(kept).toHaveTextContent(category.title);
  });

  it('every refusal is listed, each blocking one with its clearing action; R-4 renders "Not applicable"', async () => {
    const preview = payload({
      refusals: refusals({
        'R-3': {
          status: 'applies',
          message: 'This business has a platform plan subscription that is still live (Stripe live mode).',
          clearingAction: R3_CLEARING,
        },
        'R-5': { status: 'applies', message: 'This business has 1 Stripe account(s) connected.', clearingAction: 'Disconnect Stripe first (available with AD-4).' },
        'R-6': { status: 'applies', message: 'This business still has money in flight: 2 pending payments.', clearingAction: 'Resolve these first.' },
        'R-8': { status: 'unverified', message: 'Could not verify that every business data table is classified.', clearingAction: 'This is a platform problem, not something wrong with this business: contact engineering.' },
      }),
      deletionUnavailableReason: 'This business has a platform plan subscription that is still live (Stripe live mode).',
    });
    await openDialog(ok(preview));
    const list = await screen.findByTestId('deletion-refusals');
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);

    expect(screen.getByTestId('refusal-R-3')).toHaveTextContent('Stripe live mode');
    expect(screen.getByTestId('clearing-R-3')).toHaveTextContent(R3_CLEARING);
    expect(screen.getByTestId('clearing-R-5')).toHaveTextContent('Disconnect Stripe');
    expect(screen.getByTestId('clearing-R-6')).toHaveTextContent('Resolve these first');
    expect(screen.getByTestId('refusal-R-8')).toHaveTextContent(DELETION_STATUS_LABELS.unverified);
    expect(screen.getByTestId('clearing-R-8')).toHaveTextContent('contact engineering');

    const r4 = screen.getByTestId('refusal-R-4');
    expect(r4).toHaveTextContent('Not applicable');
    expect(r4).toHaveTextContent('No cross-account payment relationship exists.');
    expect(screen.getByTestId('refusal-R-7')).toHaveTextContent('Checked at the moment of deletion');
    // Clear refusals carry no clearing line.
    expect(screen.queryByTestId('clearing-R-1')).toBeNull();
  });

  it('the confirm button is disabled, described by the reason, which the status region announces', async () => {
    await openDialog(ok(payload()));
    await screen.findByTestId('deletion-refusals');
    const status = screen.getByTestId('deletion-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(
      'Deletion not yet available: deleting a business ships in a later release (the Purge level and the key rotation are not done)'
    );
    const confirm = screen.getByTestId('deletion-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-describedby', status.id);
  });

  it('offers NO confirmation input of any kind (FR-A3)', async () => {
    await openDialog(ok(payload({ refusals: refusals({ 'R-3': { status: 'applies', clearingAction: R3_CLEARING } }) })));
    const dialog = await screen.findByTestId('delete-business-dialog');
    await screen.findByTestId('deletion-refusals');
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0);
    expect(dialog.querySelectorAll('input, textarea, select')).toHaveLength(0);
  });

  it('R-1 refused: nothing counted, the rest "Not checked", the reason is R-1', async () => {
    const r1Message = 'This is your own account. An admin cannot delete their own account from the admin console.';
    const preview = payload({
      counted: false,
      areas: [],
      storage: [],
      totals: null,
      schema: null,
      resetLive: null,
      refusals: refusals({
        'R-1': { status: 'applies', message: r1Message, clearingAction: 'None from the admin console: your own account is never deleted here.' },
        'R-3': { status: 'not_evaluated', message: 'Not checked: this account is refused above.' },
      }),
      deletionUnavailableReason: r1Message,
    });
    await openDialog(ok(preview));
    expect(await screen.findByTestId('deletion-removed')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('refusal-R-3')).toHaveTextContent(DELETION_STATUS_LABELS.not_evaluated);
    expect(screen.getByTestId('deletion-status')).toHaveTextContent(`Deletion not yet available: ${r1Message}`);
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
  });

  it('R-2 unverified: blocks with its clearing action, nothing counted, the reason is R-2', async () => {
    const r2Message = 'Could not verify whether this account is a platform admin. Refusing rather than assuming it is not.';
    const preview = payload({
      counted: false,
      areas: [],
      storage: [],
      totals: null,
      schema: null,
      resetLive: null,
      refusals: refusals({
        'R-2': {
          status: 'unverified',
          message: r2Message,
          clearingAction: 'Try again. If it keeps failing, the admin list could not be read: contact engineering.',
        },
        'R-3': { status: 'not_evaluated', message: 'Not checked: this account is refused above.' },
      }),
      deletionUnavailableReason: r2Message,
    });
    await openDialog(ok(preview));
    const r2 = await screen.findByTestId('refusal-R-2');
    expect(r2).toHaveAttribute('data-status', 'unverified');
    expect(r2).toHaveTextContent(DELETION_STATUS_LABELS.unverified);
    expect(screen.getByTestId('clearing-R-2')).toHaveTextContent('admin list could not be read');
    expect(screen.getByTestId('deletion-removed')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('deletion-status')).toHaveTextContent(`Deletion not yet available: ${r2Message}`);
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
  });

  it('the two close controls have distinct accessible names', async () => {
    await openDialog(ok(payload()));
    await screen.findByTestId('deletion-refusals');
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close preview' })).toHaveLength(1);
  });

  it('a server error shows a sentence, never the raw message or details; Try again refetches', async () => {
    const fetchMock = await openDialog({
      status: 500,
      body: { success: false, error: 'Internal server error', details: 'relation "x" does not exist' },
    });
    const alert = await screen.findByTestId('deletion-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(DELETION_GENERIC_ERROR);
    expect(document.body).not.toHaveTextContent('does not exist');
    expect(document.body).not.toHaveTextContent('Internal server error');
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
    expect(screen.getByTestId('deletion-status')).toHaveTextContent('Deletion not yet available: the preview could not be loaded.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('a 404 says the account no longer exists', async () => {
    await openDialog({ status: 404, body: { success: false, error: 'user_not_found' } });
    expect(await screen.findByTestId('deletion-error')).toHaveTextContent('This account no longer exists.');
  });

  it('a network failure is the generic sentence', async () => {
    await openDialog('network_error');
    expect(await screen.findByTestId('deletion-error')).toHaveTextContent(DELETION_GENERIC_ERROR);
  });
});

// ── AD-2b: typed confirmation, commit, result ──────────────────────────────

const COMMIT_URL = `/api/admin/users/${ACCOUNT}/deletion/commit`;
const TOKEN = 'eyJ2IjoxfQ.c2ln';

/** A preview the server would answer with the off switch ON and nothing blocking. */
const offerable = (overrides: Partial<DeletionPreviewPayload> = {}) =>
  payload({
    deletionAvailable: true,
    commitToken: TOKEN,
    confirmKind: 'business name',
    resetLive: false,
    deletionUnavailableReason: 'the typed confirmation below has not been entered yet',
    ...overrides,
  });

function result(overrides: Partial<DeletionCommitResultView> = {}): DeletionCommitResultView {
  return {
    targetId: ACCOUNT,
    level: 'purge',
    options: { integrations: true, agents: false, activityHistory: false },
    snapshotPath: `purge-snapshots/${ACCOUNT}/2026-10-06T10-00-00Z.json`,
    rows: { total: 1240, byTable: { contacts: 1200, leads: 34, bookings: 5, insight_actions: 1 } },
    storage: [{ bucket: 'website-images', deleted: 7, failed: 2 }],
    residue: ['RAW-RESIDUE-TEXT: storage bucket website-images 2 objects failed'],
    invites: { revoked: 3, skippedMidSignup: 1 },
    kept: ['RAW-KEPT-TEXT'],
    notes: ['RAW-NOTE-TEXT'],
    auditRecorded: true,
    committedAt: '2026-10-06T10:00:05.000Z',
    durationMs: 4200,
    correlationId: 'corr-commit',
    previewCorrelationId: 'corr-123',
    ...overrides,
  };
}

/** Route by URL: the preview answers `preview`, the commit answers `commit`. */
function stubRoutes(preview: Reply, commit: Reply) {
  const answer = async (reply: Reply) => {
    if (reply === 'network_error') throw new TypeError('Failed to fetch');
    if (reply === 'pending') return new Promise<never>(() => undefined);
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  const fetchMock = jest.fn<Promise<unknown>, [url: string, init?: { method?: string; body?: string }]>(async (url) =>
    answer(url === COMMIT_URL ? commit : preview)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

async function openWith(preview: Reply, commit: Reply, props: { onOpenChange?: (o: boolean) => void; onDeleted?: () => void } = {}) {
  const fetchMock = stubRoutes(preview, commit);
  await act(async () => {
    render(
      <DeleteBusinessDialog
        open
        onOpenChange={props.onOpenChange ?? (() => undefined)}
        accountId={ACCOUNT}
        onDeleted={props.onDeleted}
      />
    );
  });
  return fetchMock;
}

const commitCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(([url]) => url === COMMIT_URL);

async function typeAndDelete(text: string) {
  const input = await screen.findByTestId('deletion-confirm-input');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('deletion-confirm'));
  });
}

const refusal = (status: number, body: Record<string, unknown>) => ({ status, body: { success: false, ...body } });

describe('DeleteBusinessDialog — AD-2b typed confirmation and result', () => {
  it('no token (admin delete switched off): no input, the confirm is disabled with the plain-words reason', async () => {
    const reason = 'admin delete is switched off on this server (it stays off until closing the login and the data export ship)';
    await openWith(ok(payload({ commitToken: null, deletionAvailable: false, deletionUnavailableReason: reason })), 'pending');
    await screen.findByTestId('deletion-refusals');
    expect(screen.queryByTestId('deletion-confirm-input')).toBeNull();
    expect(screen.queryByTestId('deletion-confirm-form')).toBeNull();
    expect(screen.getByTestId('deletion-status')).toHaveTextContent(`Deletion not yet available: ${reason}`);
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
  });

  it('a token with a blocking refusal still offers no input (FR-A3, defence in depth)', async () => {
    await openWith(ok(offerable({ refusals: refusals({ 'R-3': { status: 'applies', clearingAction: R3_CLEARING } }) })), 'pending');
    await screen.findByTestId('deletion-refusals');
    expect(screen.queryByTestId('deletion-confirm-input')).toBeNull();
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
  });

  it('with a token: a labelled input naming the business, the not-applied line, and the stale reason is not shown', async () => {
    await openWith(ok(offerable()), 'pending');
    const input = await screen.findByLabelText(/Type the business name to confirm/);
    expect(input).toBe(screen.getByTestId('deletion-confirm-input'));
    expect(screen.getByTestId('deletion-confirm-expected')).toHaveTextContent('Acme Therapy');
    expect(input).toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('deletion-not-applied')).toHaveTextContent(DELETION_COPY.notAppliedLine);
    expect(screen.getByTestId('deletion-status')).toHaveTextContent(DELETION_COPY.readyToConfirm);
    // The dialog's own ready line replaces the server's reason once a token is offered.
    expect(document.body).not.toHaveTextContent('the typed confirmation below has not been entered yet');
    expect(document.body).not.toHaveTextContent(DELETION_COPY.description);
  });

  it('the installed-state line: unknown says so', async () => {
    await openWith(ok(offerable({ resetLive: null })), 'pending');
    expect(await screen.findByTestId('deletion-not-applied')).toHaveTextContent(DELETION_COPY.unknownAppliedLine);
  });

  it('no business name: the admin types the account email', async () => {
    await openWith(
      ok(offerable({ confirmKind: 'account email', target: { userId: ACCOUNT, email: 'owner@example.com', businessName: null, joinedAt: null } })),
      'pending'
    );
    await screen.findByLabelText(/Type the account email to confirm/);
    expect(screen.getByTestId('deletion-confirm-expected')).toHaveTextContent('owner@example.com');
  });

  it('Delete stays disabled until the text matches (server normalisation: case and spaces), and Enter cannot bypass it', async () => {
    const fetchMock = await openWith(ok(offerable()), 'pending');
    const input = await screen.findByTestId('deletion-confirm-input');
    const confirm = screen.getByTestId('deletion-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-describedby', screen.getByTestId('deletion-status').id);

    for (const wrong of ['Acme', 'Acme Therapy Ltd', '   ']) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(confirm).toBeDisabled();
    }
    // Enter in the field with a mismatch: the form refuses, nothing is posted.
    await act(async () => {
      fireEvent.submit(screen.getByTestId('deletion-confirm-form'));
    });
    expect(commitCalls(fetchMock)).toHaveLength(0);

    fireEvent.change(input, { target: { value: '  acme   THERAPY ' } });
    expect(confirm).toBeEnabled();
  });

  it('POSTs exactly { token, confirmText } to the commit route, once', async () => {
    const fetchMock = await openWith(ok(offerable()), 'pending');
    await typeAndDelete('Acme Therapy');
    const calls = commitCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body ?? '')).toEqual({ token: TOKEN, confirmText: 'Acme Therapy' });
    // The token never travels in the URL.
    for (const [url] of fetchMock.mock.calls) expect(url).not.toContain(TOKEN);
  });

  it('while deleting: progress is announced, the controls are disabled, and the dialog will not close', async () => {
    const onOpenChange = jest.fn();
    await openWith(ok(offerable()), 'pending', { onOpenChange });
    await typeAndDelete('Acme Therapy');
    expect(screen.getByTestId('deletion-status')).toHaveTextContent(DELETION_COPY.deleting);
    expect(screen.getByTestId('deletion-confirm')).toBeDisabled();
    expect(screen.getByTestId('deletion-confirm')).toHaveTextContent(DELETION_COPY.deletingButton);
    expect(screen.getByTestId('deletion-confirm-input')).toBeDisabled();
    expect(screen.getByTestId('delete-business-dialog')).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(screen.getByTestId('delete-business-dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('success: rows per area, storage with residue, invites, what was kept, audit yes, the snapshot; never the server’s text', async () => {
    await openWith(ok(offerable()), { status: 200, body: { success: true, data: result() } });
    await typeAndDelete('Acme Therapy');
    expect(await screen.findByTestId('deletion-result')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-title')).toHaveTextContent(DELETION_COPY.resultTitle);
    expect(screen.getByTestId('deletion-title')).toHaveFocus();

    const removed = screen.getByTestId('result-removed');
    expect(removed).toHaveTextContent('1,240 rows');
    expect(screen.getByTestId('result-area-crm')).toHaveTextContent('Contacts, leads and proposals');
    expect(screen.getByTestId('result-area-crm')).toHaveTextContent('1,234 rows');
    expect(screen.getByTestId('result-area-scheduling')).toHaveTextContent('5 rows');
    expect(screen.getByTestId('result-area-other')).toHaveTextContent('Other tables');
    expect(screen.getByTestId('result-storage-website-images')).toHaveTextContent('7 files removed; 2 could not be removed');

    const invites = screen.getByTestId('result-invites');
    expect(invites).toHaveTextContent('now revoked: 3');
    expect(invites).toHaveTextContent('left alone: 1');

    const kept = screen.getByTestId('result-kept');
    for (const line of DELETION_RESULT_KEPT) expect(kept).toHaveTextContent(line);
    expect(kept).toHaveTextContent('AgentsPilot agents');

    expect(screen.getByTestId('result-audit')).toHaveTextContent(DELETION_COPY.auditRecorded);
    expect(screen.getByTestId('result-reference')).toHaveTextContent(result().snapshotPath);
    expect(screen.queryByTestId('deletion-confirm-input')).toBeNull();
    for (const raw of ['RAW-RESIDUE-TEXT', 'RAW-KEPT-TEXT', 'RAW-NOTE-TEXT']) expect(document.body).not.toHaveTextContent(raw);
  });

  it('success with the invite revoke failed and the audit row unconfirmed: both stated, never a clean success', async () => {
    await openWith(ok(offerable()), {
      status: 200,
      body: { success: true, data: result({ invites: { revoked: null, skippedMidSignup: null }, auditRecorded: false }) },
    });
    await typeAndDelete('Acme Therapy');
    const invites = await screen.findByTestId('result-invites');
    expect(invites).toHaveTextContent('could not be revoked');
    expect(invites).toHaveTextContent('signing up with: unknown');
    const audit = screen.getByTestId('result-audit');
    expect(audit).toHaveAttribute('role', 'alert');
    expect(audit).toHaveTextContent('Recorded in the audit trail: NO');
  });

  it('closing after success refreshes the list (FR-A9)', async () => {
    const onDeleted = jest.fn();
    const onOpenChange = jest.fn();
    await openWith(ok(offerable()), { status: 200, body: { success: true, data: result() } }, { onDeleted, onOpenChange });
    await typeAndDelete('Acme Therapy');
    fireEvent.click(await screen.findByTestId('deletion-close-result'));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  const RAW = 'RAW-SERVER-MESSAGE do not render';

  it.each<[string, number, Record<string, unknown>, string]>([
    ['token_expired', 409, {}, 'The preview expired. Reopen it'],
    ['token_gate_version', 409, {}, 'The preview expired. Reopen it'],
    ['token_actor', 400, {}, 'does not belong to this business or to your admin session'],
    ['confirmation_mismatch', 400, { expectedKind: 'business name' }, 'What you typed does not match the business name.'],
    ['rpc_not_applied', 409, {}, 'The delete function is not installed on this server yet. Nothing was deleted.'],
    ['admin_delete_disabled', 409, {}, 'Admin delete is switched off on this server. Nothing was deleted.'],
    ['delete_graph_refused', 409, {}, 'safety snapshot does not cover'],
    ['delete_graph_unreadable', 409, {}, 'delete rules could not be checked'],
    ['audit_unavailable', 409, {}, 'could not be recorded in the audit trail beforehand'],
    ['token_key_unavailable', 500, {}, 'cannot check the confirmation right now'],
    ['Forbidden', 403, {}, 'This account is not an admin'],
  ])('refusal %s → one plain sentence, never the server text', async (code, status, extra, sentence) => {
    await openWith(ok(offerable()), refusal(status, { error: code, message: RAW, details: RAW, ...extra, correlationId: 'corr-commit' }));
    await typeAndDelete('Acme Therapy');
    const refused = await screen.findByTestId('refused-sentence');
    expect(refused).toHaveAttribute('role', 'alert');
    expect(refused).toHaveTextContent(sentence);
    expect(screen.getByTestId('deletion-title')).toHaveTextContent(DELETION_COPY.refusedTitle);
    expect(document.body).not.toHaveTextContent('RAW-SERVER-MESSAGE');
    expect(screen.queryByTestId('deletion-confirm-input')).toBeNull();
  });

  it('a stale token offers "Reopen the preview", which fetches a fresh preview and token', async () => {
    const fetchMock = await openWith(ok(offerable()), refusal(409, { error: 'token_expired' }));
    await typeAndDelete('Acme Therapy');
    const reopen = await screen.findByTestId('deletion-reopen');
    await act(async () => {
      fireEvent.click(reopen);
    });
    await screen.findByTestId('deletion-confirm-input');
    expect(fetchMock.mock.calls.filter(([url]) => url === PREVIEW_URL)).toHaveLength(2);
    expect(screen.getByTestId('deletion-confirm-input')).toHaveValue('');
  });

  it('a refusal that arrived at commit lists what blocks now (titles only) and says a snapshot was written', async () => {
    await openWith(
      ok(offerable()),
      refusal(409, {
        error: 'refused',
        message: RAW,
        snapshotWritten: true,
        refusals: refusals({ 'R-3': { status: 'applies', message: RAW, clearingAction: RAW } }),
      })
    );
    await typeAndDelete('Acme Therapy');
    expect(await screen.findByTestId('refused-blocking')).toHaveTextContent('Blocking now: Live plan subscription.');
    expect(screen.getByTestId('refused-snapshot')).toHaveTextContent(DELETION_COPY.snapshotWrittenNote);
    expect(document.body).not.toHaveTextContent('RAW-SERVER-MESSAGE');
  });

  it.each<[string, Reply]>([
    ['a 500 with details', refusal(500, { error: 'Internal server error', details: RAW })],
    ['an unknown code', refusal(409, { error: 'something_new', message: RAW })],
    ['a network failure', 'network_error'],
  ])('%s: "the result is not known", never "nothing was deleted", and closing refreshes', async (_label, reply) => {
    const onDeleted = jest.fn();
    await openWith(ok(offerable()), reply, { onDeleted });
    await typeAndDelete('Acme Therapy');
    expect(await screen.findByTestId('deletion-unknown')).toHaveTextContent(DELETION_COMMIT_UNKNOWN);
    expect(screen.getByTestId('deletion-title')).toHaveTextContent(DELETION_COPY.unknownTitle);
    expect(document.body).not.toHaveTextContent('RAW-SERVER-MESSAGE');
    expect(document.body).not.toHaveTextContent('Internal server error');
    fireEvent.click(screen.getByTestId('deletion-close-result'));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteBusinessDialog — AD-2b SA / QA fixes (2026-10-06)', () => {
  it('SA-3: commit_failed hedges ("not known whether anything was deleted") and closing reloads the list', async () => {
    const onDeleted = jest.fn();
    await openWith(ok(offerable()), refusal(409, { error: 'commit_failed', message: 'RAW-SERVER-MESSAGE' }), { onDeleted });
    await typeAndDelete('Acme Therapy');
    const unknown = await screen.findByTestId('deletion-unknown');
    expect(unknown).toHaveTextContent('not known whether anything was deleted');
    expect(unknown).not.toHaveTextContent('Nothing was deleted');
    expect(screen.getByTestId('deletion-title')).toHaveTextContent(DELETION_COPY.unknownTitle);
    expect(document.body).not.toHaveTextContent('RAW-SERVER-MESSAGE');
    fireEvent.click(screen.getByTestId('deletion-close-result'));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown]>([
    ['no data', undefined],
    ['an empty object', {}],
    ['rows without byTable', { ...result(), rows: { total: 3 } }],
    ['a non-numeric count', { ...result(), rows: { total: 3, byTable: { contacts: 'three' } } }],
    ['storage not a list', { ...result(), storage: null }],
    ['invites missing', { ...result(), invites: undefined }],
  ])('QA: a malformed 200 (%s) does not crash: the result is not known, and closing reloads', async (_label, data) => {
    const onDeleted = jest.fn();
    await openWith(ok(offerable()), { status: 200, body: { success: true, data } }, { onDeleted });
    await typeAndDelete('Acme Therapy');
    expect(await screen.findByTestId('deletion-unknown')).toHaveTextContent(DELETION_COMMIT_UNKNOWN);
    expect(screen.queryByTestId('deletion-result')).toBeNull();
    fireEvent.click(screen.getByTestId('deletion-close-result'));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('QA: two submits in the same tick POST once (in-flight guard)', async () => {
    const fetchMock = await openWith(ok(offerable()), 'pending');
    const input = await screen.findByTestId('deletion-confirm-input');
    fireEvent.change(input, { target: { value: 'Acme Therapy' } });
    const form = screen.getByTestId('deletion-confirm-form');
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(commitCalls(fetchMock)).toHaveLength(1);
  });

  it('SA-2: the kept list says the login stays open in AD-2, never "closed"', async () => {
    await openWith(ok(offerable()), 'pending');
    const kept = await screen.findByTestId('deletion-kept');
    expect(kept).toHaveTextContent('Stays open: this deletion does not close the login');
    expect(kept).toHaveTextContent('which this deletion leaves in place');
    expect(kept).toHaveTextContent('Removing the name is part of closing the login, a later step.');
    expect(kept).not.toHaveTextContent(/Closed, not deleted|which is closed/);
  });
});
