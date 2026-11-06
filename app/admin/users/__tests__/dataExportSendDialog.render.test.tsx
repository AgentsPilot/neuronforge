/**
 * @jest-environment jsdom
 */

/**
 * "Send export to owner" dialog (export redesign MX-5, workplan §4.8,
 * T-U3 … T-U12; SA-Q7, S-1). Fetch is stubbed per test; the payloads are
 * shaped like the admin export-sends route's `data`.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DataExportSendDialog } from '../components/DataExportSendDialog';
import { DATA_EXPORT_COPY } from '../dataExportCopy';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const URL = `/api/admin/users/${ACCOUNT}/export-sends`;
const T = '2026-10-27T10:05:00.000Z';

/** The 5 modules switched on in the product (pinned by exportModules.test.ts), as the route sends them. */
const MODULES = [
  { id: 'clients', name: 'Clients' },
  { id: 'activities_tasks', name: 'Activities & tasks' },
  { id: 'quotes', name: 'Quotes' },
  { id: 'invoices_payments', name: 'Invoices & payments' },
  { id: 'account_business', name: 'Account & business details' },
];

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

type View = { state: string; modules?: typeof MODULES; sends?: unknown[]; nextSendAt?: string | null };
const view = (overrides: Partial<View> = {}) => ({ state: 'ready', modules: MODULES, sends: [], nextSendAt: null, ...overrides });
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ok = (data: unknown) => answer(200, { success: true, data });

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const gets = () => fetchMock.mock.calls.filter((call) => (call[1] as RequestInit).method === 'GET');
const posts = () => fetchMock.mock.calls.filter((call) => (call[1] as RequestInit).method === 'POST');

function open(onOpenChange: (open: boolean) => void = () => undefined) {
  return render(<DataExportSendDialog open accountId={ACCOUNT} onOpenChange={onOpenChange} />);
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('data-export-send-picker')).toBeTruthy());
}

describe('DataExportSendDialog', () => {
  it('reads once when it opens, no-store, and shows the loading line until then', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    expect(screen.getByTestId('data-export-send-loading').textContent).toBe(DATA_EXPORT_COPY.loading);
    expect(fetchMock).toHaveBeenCalledWith(URL, { method: 'GET', cache: 'no-store' });
    await act(async () => resolve(ok(view())));
    await ready();
    expect(gets()).toHaveLength(1);
  });

  it('a failed read shows its line and Try again reads again', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, { success: false })).mockResolvedValueOnce(ok(view()));
    open();
    await waitFor(() => expect(screen.getByTestId('data-export-send-read-failed')).toBeTruthy());
    expect(screen.getByText(DATA_EXPORT_COPY.readFailed)).toBeTruthy();
    fireEvent.click(screen.getByTestId('data-export-send-retry'));
    await ready();
    expect(gets()).toHaveLength(2);
  });

  it('T-U3: closed → the closed line, no tick box, no Send', async () => {
    fetchMock.mockResolvedValue(ok(view({ state: 'closed' })));
    open();
    await waitFor(() => expect(screen.getByTestId('data-export-send-state').textContent).toBe('This account is closed. Nothing can be sent.'));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTestId('data-export-send-submit')).toBeNull();
  });

  it.each(['no_login_email', 'not_found'])('T-U4: %s → the no-email line, no Send', async (state) => {
    fetchMock.mockResolvedValue(ok(view({ state })));
    open();
    await waitFor(() => expect(screen.getByTestId('data-export-send-state').textContent).toBe(DATA_EXPORT_COPY.noLoginEmail));
    expect(screen.queryByTestId('data-export-send-submit')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it("S-1: the admin's own account → its line, no Send", async () => {
    fetchMock.mockResolvedValue(ok(view({ state: 'self' })));
    open();
    await waitFor(() => expect(screen.getByTestId('data-export-send-state').textContent).toBe(DATA_EXPORT_COPY.self));
    expect(screen.queryByTestId('data-export-send-submit')).toBeNull();
  });

  it('T-U5: ready → one tick box per module, none ticked, Send disabled; Select all ticks all', async () => {
    fetchMock.mockResolvedValue(ok(view()));
    open();
    await ready();
    for (const m of MODULES) {
      const box = screen.getByTestId(`data-export-send-module-${m.id}`);
      expect(box.getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText(m.name)).toBeTruthy();
    }
    expect(screen.getByTestId('data-export-send-submit')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('data-export-send-select-all'));
    for (const m of MODULES) expect(screen.getByTestId(`data-export-send-module-${m.id}`).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('data-export-send-submit')).toHaveProperty('disabled', false);
  });

  it('T-U6: Close sends nothing', async () => {
    fetchMock.mockResolvedValue(ok(view()));
    const onOpenChange = jest.fn();
    open(onOpenChange);
    await ready();
    fireEvent.click(screen.getByTestId('data-export-send-module-clients'));
    fireEvent.click(screen.getByTestId('data-export-send-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(posts()).toHaveLength(0);
  });

  it('T-U7 / T-U8: Send posts { modules } only, cannot close in flight, then shows the sent line and reads again', async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.method === 'POST' ? new Promise((r) => (resolvePost = r)) : Promise.resolve(ok(view()))
    );
    const onOpenChange = jest.fn();
    open(onOpenChange);
    await ready();
    fireEvent.click(screen.getByTestId('data-export-send-module-quotes'));
    fireEvent.click(screen.getByTestId('data-export-send-module-clients'));
    fireEvent.click(screen.getByTestId('data-export-send-submit'));

    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0] as [string, RequestInit];
    expect(url).toBe(URL);
    // In the server's order, and nothing but the modules.
    expect(JSON.parse(init.body as string)).toEqual({ modules: ['clients', 'quotes'] });
    expect(init.cache).toBe('no-store');

    // In flight: Send disabled, a second press is not a second request, the dialog cannot close.
    expect(screen.getByTestId('data-export-send-submit')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('data-export-send-submit'));
    expect(posts()).toHaveLength(1);
    expect(screen.getByTestId('data-export-send-close')).toHaveProperty('disabled', true);
    fireEvent.keyDown(screen.getByTestId('data-export-send-dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => resolvePost(answer(201, { success: true, data: { requestId: 'r', requestedEmailSent: true } })));
    await waitFor(() => expect(screen.getByTestId('data-export-send-done').textContent).toBe(DATA_EXPORT_COPY.sent));
    await waitFor(() => expect(gets()).toHaveLength(2));
  });

  it.each([
    ['account_closed', DATA_EXPORT_COPY.closed],
    ['export_no_login_email', DATA_EXPORT_COPY.noLoginEmail],
    ['admin_self_send', DATA_EXPORT_COPY.self],
    ['export_in_progress', DATA_EXPORT_COPY.inProgress],
  ])('T-U9: a 409 %s shows its line', async (code, line) => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.method === 'POST' ? Promise.resolve(answer(409, { success: false, code, error: 'x' })) : Promise.resolve(ok(view()))
    );
    open();
    await ready();
    fireEvent.click(screen.getByTestId('data-export-send-module-clients'));
    fireEvent.click(screen.getByTestId('data-export-send-submit'));
    await waitFor(() => expect(screen.getByTestId('data-export-send-error').textContent).toBe(line));
  });

  it('T-U9: a 409 export_daily_limit shows the limit line with the time; a 500 the generic line', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.method === 'POST'
        ? Promise.resolve(answer(409, { success: false, code: 'export_daily_limit', retryAt: '2026-10-28T10:05:00.000Z', error: 'x' }))
        : Promise.resolve(ok(view()))
    );
    open();
    await ready();
    fireEvent.click(screen.getByTestId('data-export-send-module-clients'));
    fireEvent.click(screen.getByTestId('data-export-send-submit'));
    await waitFor(() => expect(screen.getByTestId('data-export-send-error').textContent).toMatch(/^2 sends a day per owner[.] You can send again at .*2026/));
  });

  it('T-U9: a 500 shows "Could not send. Please try again."', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.method === 'POST' ? Promise.resolve(answer(500, { success: false, error: 'Internal server error' })) : Promise.resolve(ok(view()))
    );
    open();
    await ready();
    fireEvent.click(screen.getByTestId('data-export-send-module-clients'));
    fireEvent.click(screen.getByTestId('data-export-send-submit'));
    await waitFor(() => expect(screen.getByTestId('data-export-send-error').textContent).toBe('Could not send. Please try again.'));
  });

  it('T-U10: nextSendAt set → the picker shows, Send stays disabled, the limit line names the time', async () => {
    fetchMock.mockResolvedValue(ok(view({ nextSendAt: '2026-10-28T10:05:00.000Z' })));
    open();
    await ready();
    expect(screen.getByTestId('data-export-send-limit').textContent).toMatch(/^2 sends a day per owner[.] You can send again at .*2026/);
    fireEvent.click(screen.getByTestId('data-export-send-select-all'));
    expect(screen.getByTestId('data-export-send-submit')).toHaveProperty('disabled', true);
  });

  it('T-U11: history rows show the time, the English module names and the status words', async () => {
    fetchMock.mockResolvedValue(
      ok(
        view({
          sends: [
            {
              requestId: 'r1',
              requestedAt: T,
              modules: [
                { module: 'clients', name: 'Clients', status: 'sent', sentAt: T, emailCount: 1 },
                { module: 'quotes', name: 'Quotes', status: 'failed', sentAt: null, emailCount: 0 },
              ],
            },
          ],
        })
      )
    );
    open();
    await ready();
    const history = screen.getByTestId('data-export-send-history');
    expect(within(history).getByText(DATA_EXPORT_COPY.historyTitle)).toBeTruthy();
    const rows = within(history).getAllByTestId('data-export-send-history-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Clients (Sent), Quotes (Failed)');
    expect(rows[0].textContent).toMatch(/27 Oct 2026/);
  });

  // QA (2026-11-04): the other three status words of §4.8 were not rendered by any case.
  it('T-U11 (QA): Waiting, Working and Interrupted render as their words', async () => {
    fetchMock.mockResolvedValue(
      ok(
        view({
          sends: [
            {
              requestId: 'r1',
              requestedAt: T,
              modules: [
                { module: 'clients', name: 'Clients', status: 'waiting', sentAt: null, emailCount: 0 },
                { module: 'quotes', name: 'Quotes', status: 'working', sentAt: null, emailCount: 0 },
                { module: 'invoices_payments', name: 'Invoices & payments', status: 'interrupted', sentAt: null, emailCount: 0 },
              ],
            },
          ],
        })
      )
    );
    open();
    await ready();
    const row = within(screen.getByTestId('data-export-send-history')).getByTestId('data-export-send-history-row');
    expect(row.textContent).toContain('Clients (Waiting), Quotes (Working), Invoices & payments (Interrupted)');
  });

  it('T-U11: no sends yet → the empty line', async () => {
    fetchMock.mockResolvedValue(ok(view()));
    open();
    await ready();
    expect(within(screen.getByTestId('data-export-send-history')).getByText(DATA_EXPORT_COPY.historyEmpty)).toBeTruthy();
  });

  it('T-U11: a history line with an unknown status is not shown; the known ones are', async () => {
    fetchMock.mockResolvedValue(
      ok(
        view({
          sends: [
            {
              requestId: 'r1',
              requestedAt: T,
              modules: [
                { module: 'clients', name: 'Clients', status: 'sent', sentAt: T, emailCount: 1 },
                { module: 'quotes', name: 'Quotes', status: 'robot', sentAt: null, emailCount: 0 },
              ],
            },
          ],
        })
      )
    );
    open();
    await ready();
    const row = within(screen.getByTestId('data-export-send-history')).getByTestId('data-export-send-history-row');
    expect(row.textContent).toContain('Clients (Sent)');
    expect(row.textContent).not.toContain('Quotes');
  });

  it('T-U12: no email address is rendered anywhere, in any state', async () => {
    for (const state of ['ready', 'closed', 'no_login_email', 'not_found', 'self']) {
      fetchMock.mockResolvedValue(ok(view({ state })));
      const { unmount } = open();
      await waitFor(() => expect(screen.queryByTestId('data-export-send-loading')).toBeNull());
      expect(document.body.textContent ?? '').not.toContain('@');
      unmount();
    }
  });
});
