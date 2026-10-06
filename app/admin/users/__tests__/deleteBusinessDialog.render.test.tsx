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
import { DELETION_GENERIC_ERROR, DELETION_KEPT_CATEGORIES, DELETION_STATUS_LABELS } from '../deletionCopy';
import type { DeletionPreviewPayload, DeletionRefusalView } from '../types';

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
