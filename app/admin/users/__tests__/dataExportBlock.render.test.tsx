/**
 * @jest-environment jsdom
 */

/**
 * The admin "Data export" box (data export DE-10a, workplan §7, §9 T-23 ...
 * T-29; TL defaults BC-1, BC-4, BC-6; SA W10-10).
 *
 * Rendered alone with fetch stubbed per URL and method. The navigation seam
 * (`browserNavigation.assign`, DE-9) is spied, so what the page WOULD open is
 * asserted without jsdom navigating.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => l };
  return { createLogger: () => l, clientLogger: l };
});
jest.mock('@/lib/logger/client', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => l };
  return { clientLogger: l };
});

import { DataExportBlock } from '../components/DataExportBlock';
import { DATA_EXPORT_COPY } from '../dataExportCopy';
import { browserNavigation } from '@/lib/client/businessOsDataExport';
import type { AdminDataExportRow, AdminDataExportStatus } from '../types';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const BASE = `/api/admin/users/${ACCOUNT}/data-exports`;
const JOB_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const JOB_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/p/1.zip?token=T';
const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

function row(over: Partial<AdminDataExportRow> = {}): AdminDataExportRow {
  return {
    jobId: JOB_A,
    requestedByKind: 'owner',
    requestedByShort: null,
    isRequestedByYou: false,
    status: 'ready',
    failureReason: null,
    createdAt: '2026-10-17T06:30:00.000Z',
    readyAt: '2026-10-17T06:30:05.000Z',
    expiresAt: FUTURE,
    ownerDownloadedAt: null,
    isDownloadable: true,
    bytes: 1_572_864,
    fileCount: 3,
    rowCount: 40,
    ...over,
  };
}

function status(over: Partial<AdminDataExportStatus> = {}): AdminDataExportStatus {
  return { exports: [row()], ownerDownloadedLatest: false, isOwnAccount: false, dailyLimit: 3, ...over };
}

interface Reply {
  status: number;
  body: unknown;
}
const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });

let getReplies: Reply[] = [];
let postReplies: Record<string, Array<Reply | 'network' | Promise<Reply>>> = {};
let calls: Array<{ method: string; url: string; body: unknown }> = [];

function installFetch() {
  global.fetch = jest.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let reply: Reply | 'network' | Promise<Reply> | undefined;
    if (method === 'GET') reply = getReplies.length > 1 ? getReplies.shift() : getReplies[0];
    else reply = postReplies[url]?.shift();
    if (reply === 'network' || reply === undefined) throw new TypeError('Failed to fetch');
    const settled = await reply;
    return { ok: settled.status < 400, status: settled.status, json: async () => settled.body } as Response;
  }) as unknown as typeof fetch;
}

let assign: jest.SpyInstance;

beforeEach(() => {
  getReplies = [ok(status())];
  postReplies = {};
  calls = [];
  installFetch();
  assign = jest.spyOn(browserNavigation, 'assign').mockImplementation(() => undefined);
});

afterEach(() => {
  assign.mockRestore();
});

async function renderBlock() {
  render(<DataExportBlock accountId={ACCOUNT} />);
  await waitFor(() => expect(screen.queryByText(DATA_EXPORT_COPY.loading)).toBeNull());
}

const gets = () => calls.filter((call) => call.method === 'GET');
const typeReason = (text: string) => fireEvent.change(screen.getByTestId('data-export-reason'), { target: { value: text } });

describe('T-23 the list', () => {
  it('owner, admin and "you" rows with each state in words and sizes; newest first', async () => {
    getReplies = [
      ok(
        status({
          exports: [
            row({ jobId: JOB_A, requestedByKind: 'admin', requestedByShort: 'ab12cd34', isRequestedByYou: true }),
            row({ jobId: JOB_B, requestedByKind: 'admin', requestedByShort: 'ef56ab78', status: 'expired', isDownloadable: false }),
            row({ jobId: 'cccccccc-3333-4333-8333-333333333333', status: 'failed', failureReason: 'over_ceiling', isDownloadable: false, bytes: null, fileCount: null }),
            row({ jobId: 'dddddddd-4444-4444-8444-444444444444', status: 'running', isDownloadable: false, expiresAt: null }),
            row({ jobId: 'eeeeeeee-5555-4555-8555-555555555555', ownerDownloadedAt: '2026-10-17T06:31:00.000Z' }),
          ],
        })
      ),
    ];
    await renderBlock();
    const rows = screen.getAllByTestId('data-export-row');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => within(r).getByTestId('data-export-row-who').textContent)).toEqual([
      'by you',
      'by admin ef56ab78',
      'by the owner',
      'by the owner',
      'by the owner',
    ]);
    const states = rows.map((r) => within(r).getByTestId('data-export-row-state').textContent);
    expect(states[0]).toMatch(/^Ready until \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(states.slice(1, 4)).toEqual(['Expired', 'Failed — too large', 'Being prepared']);
    expect(within(rows[0]).getByTestId('data-export-row-size').textContent).toBe('3 files, 1.5 MB');
    expect(within(rows[2]).queryByTestId('data-export-row-size')).toBeNull();
    expect(within(rows[0]).getByTestId('data-export-row-time').textContent).toContain('2026-10-17 06:30 UTC');
    expect(within(rows[4]).getByTestId('data-export-row-owner-download').textContent).toBe('Downloaded by the owner 2026-10-17 06:31 UTC');
    // Three shown, the rest folded and still in the DOM (BD-8).
    expect(screen.getByTestId('data-export-more-rest').hidden).toBe(true);
    expect(within(screen.getByTestId('data-export-more-rest')).getAllByTestId('data-export-row')).toHaveLength(2);
    // Admin rows carry no owner-download line.
    expect(within(rows[0]).queryByTestId('data-export-row-owner-download')).toBeNull();
  });

  it('the empty state', async () => {
    getReplies = [ok(status({ exports: [] }))];
    await renderBlock();
    expect(screen.getByTestId('data-export-empty').textContent).toBe('No exports yet.');
  });

  it.each([
    ['a 500', { status: 500, body: { success: false, error: 'The exports could not be read.' } }],
    ['a non-JSON body', { status: 502, body: undefined }],
  ])('%s says the exports could not be read, never an empty list; Retry reads again', async (_label, reply) => {
    getReplies = [reply as Reply, ok(status())];
    await renderBlock();
    expect(screen.getByTestId('data-export-error').textContent).toBe('The exports could not be read.');
    expect(screen.queryByTestId('data-export-empty')).toBeNull();
    fireEvent.click(screen.getByTestId('data-export-retry'));
    await screen.findByTestId('data-export-row');
    expect(gets()).toHaveLength(2);
  });

  it('a network failure is the same read error', async () => {
    getReplies = [];
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await renderBlock();
    expect(screen.getByTestId('data-export-error').textContent).toBe('The exports could not be read.');
  });
});

describe('T-24 BC-4 the owner warning', () => {
  it('shown when the owner has not downloaded, hidden when they have', async () => {
    const { unmount } = render(<DataExportBlock accountId={ACCOUNT} />);
    expect((await screen.findByTestId('data-export-owner-warning')).textContent).toBe(DATA_EXPORT_COPY.ownerNotDownloaded);
    unmount();
    getReplies = [ok(status({ ownerDownloadedLatest: true }))];
    await renderBlock();
    expect(screen.queryByTestId('data-export-owner-warning')).toBeNull();
  });
});

describe('T-25 prepare', () => {
  it('Send stays disabled under 5 characters; one POST per Send with the trimmed reason; success closes, says so and reads again', async () => {
    let release!: (reply: Reply) => void;
    postReplies[BASE] = [new Promise<Reply>((resolve) => (release = resolve))];
    getReplies = [ok(status()), ok(status({ exports: [row({ jobId: JOB_B, requestedByKind: 'admin', isRequestedByYou: true })] }))];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-prepare'));
    const dialog = await screen.findByTestId('data-export-dialog');
    expect(dialog.getAttribute('data-mode')).toBe('prepare');
    expect(document.activeElement).toBe(screen.getByTestId('data-export-reason'));
    const send = screen.getByTestId('data-export-dialog-send') as HTMLButtonElement;
    typeReason('abcd');
    expect(send.disabled).toBe(true);
    typeReason('  Owner asked  ');
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    fireEvent.click(send);
    // In flight: one request, Send and Close disabled, the dialog cannot be closed.
    await screen.findByTestId('data-export-dialog-busy');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([{ method: 'POST', url: BASE, body: { reason: 'Owner asked' } }]);
    expect((screen.getByTestId('data-export-dialog-close') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByTestId('data-export-dialog')).toBeTruthy();

    await act(async () => release(ok({ jobId: JOB_B, expiresAt: '2026-10-20T06:30:05.000Z' })));
    await waitFor(() => expect(screen.queryByTestId('data-export-dialog')).toBeNull());
    expect(screen.getByTestId('data-export-notice').textContent).toContain('Export prepared. Ready until 2026-10-20 06:30 UTC. Download it below.');
    await waitFor(() => expect(gets()).toHaveLength(2));
    // The prepare answer carries no link and nothing navigates.
    expect(assign).not.toHaveBeenCalled();
  });

  it('a 75 s client timeout closes with the "still preparing" line', async () => {
    // Plain fake timers (no advanceTimers: the CI flake pattern, #399); RTL waitFor drives them.
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn((input: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: status() }) } as Response);
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }) as unknown as typeof fetch;
      await renderBlock();
      fireEvent.click(screen.getByTestId('data-export-prepare'));
      await screen.findByTestId('data-export-dialog');
      typeReason('Owner asked');
      fireEvent.click(screen.getByTestId('data-export-dialog-send'));
      await act(async () => {
        jest.advanceTimersByTime(75_000);
      });
      await waitFor(() => expect(screen.queryByTestId('data-export-dialog')).toBeNull());
      expect(screen.getByTestId('data-export-notice').textContent).toContain(DATA_EXPORT_COPY.clientTimeout);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('T-26 download', () => {
  it('BC-1: after a prepare, that export opens Download with the prepare reason; 200 https navigates once', async () => {
    postReplies[BASE] = [ok({ jobId: JOB_B, expiresAt: FUTURE })];
    postReplies[`${BASE}/${JOB_B}/parts/1/download`] = [ok({ downloadUrl: SIGNED, fileName: 'f.zip', asciiFileName: 'f.zip', expiresAt: FUTURE, linkSeconds: 60 })];
    getReplies = [ok(status()), ok(status({ exports: [row({ jobId: JOB_B, requestedByKind: 'admin', isRequestedByYou: true })] }))];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-prepare'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Hand over before delete');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    await waitFor(() => expect(screen.queryByTestId('data-export-dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('data-export-row')[0].getAttribute('data-job-id')).toBe(JOB_B));

    fireEvent.click(screen.getByTestId('data-export-download'));
    const dialog = await screen.findByTestId('data-export-dialog');
    expect(dialog.getAttribute('data-mode')).toBe('download');
    expect(dialog.textContent).toContain(DATA_EXPORT_COPY.downloadDescription);
    expect((screen.getByTestId('data-export-reason') as HTMLTextAreaElement).value).toBe('Hand over before delete');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(SIGNED);
    expect(calls.filter((call) => call.method === 'POST').map((call) => [call.url, call.body])).toEqual([
      [BASE, { reason: 'Hand over before delete' }],
      [`${BASE}/${JOB_B}/parts/1/download`, { reason: 'Hand over before delete' }],
    ]);
    expect(screen.getByTestId('data-export-notice').textContent).toContain(DATA_EXPORT_COPY.downloadStarted);
  });

  it('an export not prepared here opens with an empty reason', async () => {
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-download'));
    await screen.findByTestId('data-export-dialog');
    expect((screen.getByTestId('data-export-reason') as HTMLTextAreaElement).value).toBe('');
  });

  it('a link that is not https is never followed', async () => {
    postReplies[`${BASE}/${JOB_A}/parts/1/download`] = [ok({ downloadUrl: 'javascript:alert(1)', fileName: 'f', asciiFileName: 'f', expiresAt: FUTURE })];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-download'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Hand over now');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    expect((await screen.findByTestId('data-export-dialog-error')).textContent).toBe(DATA_EXPORT_COPY.unsafeLink);
    expect(assign).not.toHaveBeenCalled();
  });

  it('503 audit_unavailable shows its sentence in the dialog and does not navigate', async () => {
    postReplies[`${BASE}/${JOB_A}/parts/1/download`] = [{ status: 503, body: { success: false, code: 'audit_unavailable', error: 'x' } }];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-download'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Hand over now');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    expect((await screen.findByTestId('data-export-dialog-error')).textContent).toBe(
      'The download could not be recorded, so it was not started. Try again.'
    );
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('data-export-dialog')).toBeTruthy();
  });
});

describe('T-27 each refusal has its sentence', () => {
  it.each([
    [409, 'export_in_progress', 'An export of this account is already being prepared. Wait a minute and try again.'],
    [409, 'export_daily_limit', "This account has used its exports of the last 24 hours (the owner's and admins' together). Next one possible at 2026-10-18 06:30 UTC."],
    [413, 'export_too_large', 'This account holds more than Phase 1 can package (over 40 MB of files or 150 files). Nothing was prepared.'],
    [503, 'export_timeout', 'The export could not be prepared in time. Try again.'],
    [500, 'export_failed', 'The export could not be prepared. Try again.'],
    [403, 'own_account', 'Use Download my data in your own settings for your own account.'],
    [403, null, DATA_EXPORT_COPY.session],
    [401, null, DATA_EXPORT_COPY.session],
    [429, null, 'Too many requests. Wait a few minutes and try again.'],
  ])('prepare %i %s', async (code, refusal, sentence) => {
    postReplies[BASE] = [{ status: code, body: { success: false, code: refusal ?? undefined, retryAt: '2026-10-18T06:30:00.000Z', error: 'x' } }];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-prepare'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Owner asked');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    expect((await screen.findByTestId('data-export-dialog-error')).textContent).toBe(sentence);
  });

  it('download 410 export_expired', async () => {
    postReplies[`${BASE}/${JOB_A}/parts/1/download`] = [{ status: 410, body: { success: false, code: 'export_expired' } }];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-download'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Hand over now');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    expect((await screen.findByTestId('data-export-dialog-error')).textContent).toBe('This export is no longer available. Prepare a new one.');
  });

  it('a network failure', async () => {
    postReplies[BASE] = ['network'];
    await renderBlock();
    fireEvent.click(screen.getByTestId('data-export-prepare'));
    await screen.findByTestId('data-export-dialog');
    typeReason('Owner asked');
    fireEvent.click(screen.getByTestId('data-export-dialog-send'));
    expect((await screen.findByTestId('data-export-dialog-error')).textContent).toBe(DATA_EXPORT_COPY.network);
  });
});

describe('T-28 BC-6 the admin own account', () => {
  it('no Prepare, no Download, no warning; the pointer line', async () => {
    getReplies = [ok(status({ isOwnAccount: true }))];
    await renderBlock();
    expect(screen.getByTestId('data-export-own-account').textContent).toBe(DATA_EXPORT_COPY.ownAccount);
    expect(screen.queryByTestId('data-export-prepare')).toBeNull();
    expect(screen.queryByTestId('data-export-download')).toBeNull();
    expect(screen.queryByTestId('data-export-owner-warning')).toBeNull();
  });
});

describe('T-29 one read per mount', () => {
  it('one GET when mounted, none on a re-render', async () => {
    const { rerender } = render(<DataExportBlock accountId={ACCOUNT} />);
    await screen.findByTestId('data-export-row');
    rerender(<DataExportBlock accountId={ACCOUNT} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(gets().map((call) => call.url)).toEqual([BASE]);
  });

  it('the section is the boxed Data export group with its purpose line, and no decorative green', async () => {
    await renderBlock();
    const group = screen.getByRole('group', { name: 'Data export' });
    expect(group.getAttribute('data-testid')).toBe('drawer-section-export');
    expect(screen.getByTestId('drawer-purpose-export')).toBeTruthy();
    const classes = Array.from(document.querySelectorAll('[class]')).map((el) => el.getAttribute('class') ?? '');
    expect(classes.filter((cls) => /emerald|teal|cyan|orange|from-|bg-gradient/.test(cls))).toEqual([]);
  });
});
