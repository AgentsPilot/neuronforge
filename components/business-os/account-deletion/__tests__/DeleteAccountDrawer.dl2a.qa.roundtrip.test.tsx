/**
 * @jest-environment jsdom
 *
 * QA, DL-2a (DL-2 workplan § QA Testing Report (DL-2a), items 1, 3, 4, 5).
 *
 * A REAL round trip. The Danger Zone dialog host is rendered, and its `fetch`
 * is handed to the REAL route handlers:
 *
 *   POST /api/business-os/account/delete   (real Zod `.strict()` body schema, real
 *                                           statement match, real runClosureRequest)
 *   GET  /api/business-os/account/closure  (real closureStatusView, real closureLockAt)
 *   POST /api/business-os/account/keep     (real runClosureKeep)
 *
 * Only the seams are mocked: the session, the throttle, the audit flush, the
 * logger, and the three production ports (`closureRequestDeps`,
 * `closureStatusDeps`, `closureKeepDeps`), which share ONE in-memory closure
 * table, so what the request writes is what the closure route reads and what
 * Keep moves. The pre-check (`deletion-check`) is answered at the fetch level:
 * it is not under test here.
 *
 * jsdom has no Fetch API classes, so `Request` / `Response` / `Headers` come
 * from undici (Node's own implementation) before `next/server` is loaded.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Fetch API classes for the route handlers (jsdom lacks them) ─────────────
const g = global as unknown as Record<string, unknown>;
// undici reads these at load time, so they go first.
const nodeUtil = jest.requireActual('util') as Record<string, unknown>;
const nodeWebStreams = jest.requireActual('stream/web') as Record<string, unknown>;
const nodeWorkers = jest.requireActual('worker_threads') as Record<string, unknown>;
const nodeBuffer = jest.requireActual('buffer') as Record<string, unknown>;
for (const [name, source] of [
  ['TextEncoder', nodeUtil],
  ['TextDecoder', nodeUtil],
  ['ReadableStream', nodeWebStreams],
  ['WritableStream', nodeWebStreams],
  ['TransformStream', nodeWebStreams],
  ['MessageChannel', nodeWorkers],
  ['MessagePort', nodeWorkers],
  ['Blob', nodeBuffer],
  ['File', nodeBuffer],
] as const) {
  if (typeof g[name] !== 'function' && typeof source[name] === 'function') g[name] = source[name];
}
const undici = jest.requireActual('undici') as Record<string, unknown>;
for (const name of ['Request', 'Response', 'Headers', 'FormData']) {
  if (typeof g[name] !== 'function') g[name] = undici[name];
}
const webCrypto = g.crypto as { randomUUID?: () => string } | undefined;
if (webCrypto && typeof webCrypto.randomUUID !== 'function') {
  webCrypto.randomUUID = (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID;
}

// ── Seams ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = () => undefined;
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: async () => ({ allowed: true, hits: 1, degraded: false }) };
});
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  errorKindFacts: (err: unknown) => ({ kind: null, code: null, name: err instanceof Error ? err.name : null }),
}));
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: async () => undefined }));

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  // The dictionaries only: the real module also builds a Supabase browser client.
  const dictionaries: Record<string, Record<string, string>> = {
    en: jest.requireActual('@/lib/business-os/translations/en').en,
    he: jest.requireActual('@/lib/business-os/translations/he').he,
    es: jest.requireActual('@/lib/business-os/translations/es').es,
  };
  // The provider's own `t`, byte for byte: the dictionary line or the key, then `{name}` slots.
  const t = (key: string, vars?: Record<string, string | number>) => {
    let text = dictionaries[mockLang.language][key] || key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\{${name}\}`, 'g'), String(value));
    return text;
  };
  return { useOptionalLanguage: () => ({ language: mockLang.language, isRTL: mockLang.language === 'he', t }) };
});

// ── One in-memory closure table behind the three ports ──────────────────────
interface Row {
  id: string;
  user_id: string;
  status: 'requesting' | 'pending' | 'grace' | 'locked' | 'kept';
  renewal_was_on: boolean;
  plan_ends_at: string | null;
  lock_at: string | null;
  lock_timezone: string | null;
}
const SUBJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENDS = '2026-11-26T10:00:00.000Z';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const OPEN = ['requesting', 'pending', 'grace', 'locked'];

interface World {
  rows: Row[];
  billing: Record<string, unknown> | null;
  zone: string | null;
  /** The closure route's timezone read fails (W-4 d). */
  statusZoneFails: boolean;
  cancelEngine: Record<string, unknown>;
  /** P-8: the requesting → pending transition fails. */
  pendingTransitionFails: boolean;
  /** CR-6: the insert races another tab, and the re-read then finds nothing. */
  insertAlreadyOpen: boolean;
  /** Ids the closure route's deps were asked for. */
  statusReadIds: string[];
}
let world: World;
let nextId = 1;
const openRow = (userId: string) => world.rows.find((row) => row.user_id === userId && OPEN.includes(row.status)) ?? null;

function transition(id: string, userId: string, from: string, to: string, patch: Record<string, unknown>) {
  const row = world.rows.find((r) => r.id === id && r.user_id === userId);
  if (!row || row.status !== from) return { data: false, error: null };
  if (from === 'requesting' && to === 'pending' && world.pendingTransitionFails) return { data: false, error: null };
  Object.assign(row, patch, { status: to });
  return { data: true, error: null };
}

jest.mock('@/lib/business-os/account-deletion/closureRequestDeps', () => ({
  closureRequestDeps: () => ({
    closures: {
      findOpenForUser: async (userId: string) => {
        const row = openRow(userId);
        return { data: row ? { id: row.id, status: row.status } : null, error: null };
      },
      insertRequesting: async (input: { userId: string; renewalWasOn: boolean; planEndsAt: string | null }) => {
        if (world.insertAlreadyOpen) return { data: null, error: Object.assign(new Error('open'), { code: 'already_open' }) };
        const row: Row = {
          id: `c${nextId++}`,
          user_id: input.userId,
          status: 'requesting',
          renewal_was_on: input.renewalWasOn,
          plan_ends_at: input.planEndsAt,
          lock_at: null,
          lock_timezone: null,
        };
        world.rows.push(row);
        return { data: { id: row.id, status: row.status }, error: null };
      },
      transition: async (id: string, userId: string, from: string, to: string, patch: Record<string, unknown>) => transition(id, userId, from, to, patch),
      deleteRequesting: async (id: string) => {
        world.rows = world.rows.filter((row) => !(row.id === id && row.status === 'requesting'));
        return { data: true, error: null };
      },
    },
    billingRow: async () => ({ data: world.billing, error: null }),
    livemode: () => false,
    pricesEnabled: () => true,
    runCheck: async () => ({ kind: 'checked', canDelete: true, targetUserId: SUBJECT, blockers: [], notes: [], guards: [], rows: [], verdictBlocked: false, resolvedThisLogin: true, serverMs: 1 }),
    readTimezone: async () => ({ data: world.zone, error: null }),
    manage: async () => world.cancelEngine,
    now: () => NOW,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  }),
}));

jest.mock('@/lib/business-os/account-deletion/closureStatusDeps', () => ({
  closureStatusDeps: () => ({
    readOpen: async (userId: string) => {
      world.statusReadIds.push(userId);
      const row = openRow(userId);
      return {
        data: row ? { status: row.status, renewal_was_on: row.renewal_was_on, plan_ends_at: row.plan_ends_at, lock_at: row.lock_at, lock_timezone: row.lock_timezone } : null,
        error: null,
      };
    },
    readTimezone: async () => (world.statusZoneFails ? { ok: false } : { ok: true, stored: world.zone }),
  }),
}));

const REACTIVATED = { ok: true, outcome: 'reactivated', renewsOn: ENDS, audit: { action: 'reactivate', outcome: 'reactivated', subscriptionId: 'sub_own', endsOn: null, renewsOn: ENDS, livemode: false, mode: 'period_end', reasonCode: null, origin: 'deletion_keep' } };
jest.mock('@/lib/business-os/account-deletion/closureKeepDeps', () => ({
  closureKeepDeps: () => ({
    closures: {
      findOpenForUser: async (userId: string) => {
        const row = openRow(userId);
        return { data: row ? { id: row.id, status: row.status, renewal_was_on: row.renewal_was_on, plan_ends_at: row.plan_ends_at } : null, error: null };
      },
      findById: async (id: string, userId: string) => {
        const row = world.rows.find((r) => r.id === id && r.user_id === userId);
        return { data: row ? { id: row.id, status: row.status, renewal_was_on: row.renewal_was_on, plan_ends_at: row.plan_ends_at } : null, error: null };
      },
      transition: async (id: string, userId: string, from: string, to: string, patch: Record<string, unknown>) => transition(id, userId, from, to, patch),
    },
    manage: async () => REACTIVATED,
    now: () => NOW,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  }),
}));

// ── The modules under test (loaded after the globals above) ─────────────────
/* eslint-disable @typescript-eslint/no-require-imports */
const { NextRequest } = require('next/server') as typeof import('next/server');
const deleteRoute = require('@/app/api/business-os/account/delete/route') as typeof import('@/app/api/business-os/account/delete/route');
const closureRoute = require('@/app/api/business-os/account/closure/route') as typeof import('@/app/api/business-os/account/closure/route');
const keepRoute = require('@/app/api/business-os/account/keep/route') as typeof import('@/app/api/business-os/account/keep/route');
const { Dialog, DialogContent, DialogTrigger } = require('@/components/ui/dialog') as typeof import('@/components/ui/dialog');
const { ErasureDialogBody } = require('@/components/business-os/purge/DangerZonePanel') as typeof import('@/components/business-os/purge/DangerZonePanel');
const { DELETION_STATEMENTS } = require('@/lib/business-os/account-deletion/acknowledgement') as typeof import('@/lib/business-os/account-deletion/acknowledgement');
const { accountDeleteBodySchema } = require('@/lib/business-os/account-deletion/schemas') as typeof import('@/lib/business-os/account-deletion/schemas');
const { PLACEHOLDER_ERASURE_CONTACT } = require('@/lib/business-os/supportContact') as typeof import('@/lib/business-os/supportContact');
const { formatAccountDay } = require('@/components/business-os/settings/planUpgradeCopy') as typeof import('@/components/business-os/settings/planUpgradeCopy');
const translations = {
  en: require('@/lib/business-os/translations/en').en,
  he: require('@/lib/business-os/translations/he').he,
  es: require('@/lib/business-os/translations/es').es,
} as Record<Lang, Record<string, string>>;
/* eslint-enable @typescript-eslint/no-require-imports */

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';
const SECRET_ENV = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const KEY_ENV = ['DELETION', 'RECEIPT', 'FINGERPRINT', 'KEY'].join('_');
const DELETE_URL = '/api/business-os/account/delete';
const CLOSURE_URL = '/api/business-os/account/closure';
const KEEP_URL = '/api/business-os/account/keep';
const CHECK_URL = '/api/business-os/account/deletion-check';
const READY = { enabled: true, available: true, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };

const RENEWING = {
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: ENDS,
  endedAt: null,
  failedAttempts: 0,
  pendingTier: null,
  openCheckoutSessionId: null,
  openCheckoutExpiresAt: null,
};
const CANCELLED = { ok: true, outcome: 'cancelled', mode: 'period_end', endsOn: ENDS, audit: { action: 'cancel', outcome: 'cancelled', subscriptionId: 'sub_own', endsOn: ENDS, renewsOn: null, livemode: false, mode: 'period_end', reasonCode: 'other', origin: 'deletion_request' } };

interface Exchange {
  url: string;
  method: string;
  sent: unknown;
  status: number;
  answer: unknown;
  cacheControl: string | null;
}
const exchanges: Exchange[] = [];
/** A per-URL hook: return a promise to hold the answer, or 'offline' to fail like a network drop. */
let interceptor: ((url: string) => Promise<void> | 'offline' | void) | null = null;

const fetchMock = jest.fn(async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
  const hold = interceptor?.(url);
  if (hold === 'offline') throw new TypeError('Failed to fetch');
  if (url === CHECK_URL) return { ok: true, status: 200, json: async () => ({ success: true, data: READY }) };
  const method = init.method ?? 'GET';
  const request = new NextRequest(`http://localhost${url}`, {
    method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  const path = url.split('?')[0];
  const handler =
    path === DELETE_URL ? deleteRoute.POST : path === KEEP_URL ? keepRoute.POST : path === CLOSURE_URL ? closureRoute.GET : null;
  if (!handler) throw new Error(`unexpected ${url}`);
  // The answer is worked out when the request is made; a held answer is delivered later (stale on purpose).
  const response = await handler(request);
  const answer = await response.json();
  if (hold) await hold;
  exchanges.push({ url, method, sent: init.body === undefined ? undefined : JSON.parse(init.body), status: response.status, answer, cacheControl: response.headers.get('cache-control') });
  return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => answer };
});

beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});
afterAll(() => {
  delete (global as unknown as { fetch?: unknown }).fetch;
  delete process.env[FLAG];
  delete process.env[SECRET_ENV];
  delete process.env[KEY_ENV];
});

beforeEach(() => {
  mockLang.language = 'en';
  exchanges.length = 0;
  interceptor = null;
  fetchMock.mockClear();
  mockRefresh.mockReset();
  world = {
    rows: [],
    billing: { ...RENEWING },
    zone: 'Asia/Jerusalem',
    statusZoneFails: false,
    cancelEngine: CANCELLED,
    pendingTransitionFails: false,
    insertAlreadyOpen: false,
    statusReadIds: [],
  };
  process.env[FLAG] = 'true';
  process.env[SECRET_ENV] = 's'.repeat(40);
  process.env[KEY_ENV] = 'k'.repeat(48);
  mockSession.mockReset().mockResolvedValue({ id: SUBJECT, email: 'jane.owner@example.org' });
});

jest.setTimeout(30000);

// ── Helpers ──────────────────────────────────────────────────────────────────
const sent = (url: string) => exchanges.filter((e) => e.url.split('?')[0] === url);

/** The dictionary line as the owner reads it: slots filled, `{support}` as the mailto's text. */
function expected(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const template = translations[lang][key];
  if (!template) throw new Error(`no ${lang} line for ${key}`);
  let text = template;
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text.split('{support}').join(PLACEHOLDER_ERASURE_CONTACT);
}

function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger>Delete account</DialogTrigger>
      <DialogContent>
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
}

async function tabTo(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let i = 0; i < 30 && document.activeElement !== element; i += 1) await user.tab();
  expect(document.activeElement).toBe(element);
}

/** Keyboard only: open the dialog, Tab to the reason group, Space, Tab to the box, type, Enter. */
async function requestByKeyboard(lang: Lang, reason = 'business_closing') {
  mockLang.language = lang;
  const user = userEvent.setup({ delay: null });
  render(<SettingsDialog />);
  const trigger = screen.getByRole('button', { name: 'Delete account' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog');
  const drawer = await within(dialog).findByTestId('delete-account-drawer');
  expect(drawer).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');

  const first = within(dialog).getByTestId('delete-account-reason-too_expensive');
  await tabTo(user, first);
  // Arrow keys move inside the one group (one Tab stop); walk to the wanted code.
  await user.keyboard(' ');
  const target = within(dialog).getByTestId(`delete-account-reason-${reason}`);
  for (let i = 0; i < 8 && !(target as HTMLInputElement).checked; i += 1) await user.keyboard('{ArrowDown}');
  expect(target).toBeChecked();

  const box = within(dialog).getByRole('textbox');
  await tabTo(user, box);
  const button = within(dialog).getByRole('button', { name: translations[lang]['settings.account_delete.request_button'] });
  expect(button).toBeDisabled();
  await user.keyboard(DELETION_STATEMENTS[lang]);
  expect(button).toBeEnabled();
  await user.keyboard('{Enter}');
  return { user, dialog, trigger };
}

function noRawKeyOrSlot(element: HTMLElement) {
  const text = element.textContent ?? '';
  expect(text.trim()).not.toBe('');
  expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  expect(text).not.toMatch(/\b(settings|account_closure|plan)\.[a-z_.]+/);
}

// ── 1. The request body against the real strict schema ──────────────────────
describe('1. the drawer body passes the REAL route schema (round trip)', () => {
  it.each<Lang>(['en', 'he', 'es'])('%s: posts { statement, language, reasonCode }, the real route answers 200, never 400', async (lang) => {
    await requestByKeyboard(lang, 'business_closing');
    await waitFor(() => expect(sent(DELETE_URL)).toHaveLength(1));
    const [exchange] = sent(DELETE_URL);
    expect(exchange.sent).toEqual({ statement: DELETION_STATEMENTS[lang], language: lang, reasonCode: 'business_closing' });
    expect(accountDeleteBodySchema.safeParse(exchange.sent).success).toBe(true);
    expect(exchange.status).toBe(200);
    expect(exchange.answer).toMatchObject({ success: true, data: { status: 'pending', planEndsOn: ENDS, renewalWasOn: true } });
    expect(world.rows).toHaveLength(1);
    expect(world.rows[0]).toMatchObject({ status: 'pending', user_id: SUBJECT, plan_ends_at: ENDS });
  });

  it('the OLD body (no reasonCode) is refused by the same real route with 400 invalid_body, and nothing is written', async () => {
    const res = await deleteRoute.POST(
      new NextRequest(`http://localhost${DELETE_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: DELETION_STATEMENTS.en, language: 'en' }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(world.rows).toEqual([]);
  });
});

// ── 4. Keyboard only, end to end, through the real routes ───────────────────
describe('4. keyboard only: request → pending view → Keep → kept notice (real routes)', () => {
  it.each<Lang>(['en', 'he', 'es'])('%s', async (lang) => {
    const { user, dialog } = await requestByKeyboard(lang);
    // IN-19 / IN-7: the pending view's first line takes focus.
    const body = await within(dialog).findByTestId('closure-pending-body');
    await waitFor(() => expect(document.activeElement).toBe(body));
    const panel = within(dialog).getByTestId('closure-pending-panel');
    expect(panel).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    expect(dialog).toHaveAccessibleDescription(translations[lang]['account_closure.heading']);

    // The real closure route projected the lock: 14 days after the plan end, in Asia/Jerusalem.
    const closureAnswer = sent(CLOSURE_URL).at(-1)!.answer as { data: { closure: Record<string, unknown> } };
    const view = closureAnswer.data.closure;
    expect(view).toMatchObject({ status: 'pending', planEndsAt: ENDS, lockAtIsProjected: true, timezone: 'Asia/Jerusalem', graceDays: 14 });
    const planEnd = formatAccountDay(ENDS, lang, 'Asia/Jerusalem')!;
    const lockDate = formatAccountDay(view.lockAt as string, lang, 'Asia/Jerusalem')!;
    expect(body).toHaveTextContent(expected(lang, 'account_closure.pending_body', { planEnd, days: 14, lockDate }));
    noRawKeyOrSlot(body);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    const keep = within(dialog).getByRole('button', { name: translations[lang]['account_closure.keep_button'] });
    await tabTo(user, keep);
    await user.keyboard('{Enter}');
    const notice = await within(dialog).findByTestId('closure-notice');
    await waitFor(() => expect(document.activeElement).toBe(notice));
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    expect(notice).toHaveTextContent(expected(lang, 'account_closure.kept.restored'));
    expect(sent(KEEP_URL)).toHaveLength(1);
    expect(sent(KEEP_URL)[0]).toMatchObject({ sent: {}, status: 200 });
    expect(world.rows[0].status).toBe('kept');
    // The re-read after Keep finds nothing open; the line stays.
    await waitFor(() => expect((sent(CLOSURE_URL).at(-1)!.answer as { data: { closure: unknown } }).data.closure).toBeNull());
    expect(within(dialog).getByTestId('closure-notice')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('refusal by keyboard: the switch went off after the page loaded (real 404) → the alert takes focus; Tab returns to the button; one dialog', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    screen.getByRole('button', { name: 'Delete account' }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await tabTo(user, await within(dialog).findByTestId('delete-account-reason-too_expensive'));
    await user.keyboard(' ');
    await tabTo(user, within(dialog).getByRole('textbox'));
    // The client and the server share one statement matcher, so the form cannot reach a real
    // `statement_mismatch`; the refusal driven through the real route here is the switch-off 404.
    await user.keyboard(DELETION_STATEMENTS.en);
    process.env[FLAG] = 'false'; // the switch went off after the page loaded → the real route answers 404
    await user.keyboard('{Enter}');
    const alert = await within(dialog).findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(alert).toHaveTextContent(expected('en', 'settings.account_delete.not_available'));
    expect(sent(DELETE_URL)[0].status).toBe(404);
    // Tab: the support mailto inside the alert, then the request button.
    await user.tab();
    expect(document.activeElement).toBe(within(alert).getByRole('link', { name: PLACEHOLDER_ERASURE_CONTACT }));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Delete my account forever' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

// ── 3. The closure route, through the UI and directly ───────────────────────
describe('3. GET /api/business-os/account/closure (real route)', () => {
  it('the timezone read fails → lockAt and planEndsAt null on the wire, and the _nodate lines show (pending, then Keep)', async () => {
    world.statusZoneFails = true;
    // P-2: already set to end this period, so Keep answers not_restored_by_choice.
    world.cancelEngine = { ok: true, outcome: 'unchanged', state: 'cancelling', date: ENDS };
    world.billing = { ...RENEWING, cancelAtPeriodEnd: true };
    const { user, dialog } = await requestByKeyboard('he');
    const body = await within(dialog).findByTestId('closure-pending-body');
    const view = (sent(CLOSURE_URL).at(-1)!.answer as { data: { closure: Record<string, unknown> } }).data.closure;
    expect(view).toMatchObject({ status: 'pending', lockAt: null, planEndsAt: null, timezone: 'UTC', lockAtIsProjected: false });
    expect(body).toHaveTextContent(expected('he', 'account_closure.pending_body_nodate', { days: 14 }));
    noRawKeyOrSlot(body);

    await tabTo(user, within(dialog).getByRole('button', { name: translations.he['account_closure.keep_button'] }));
    await user.keyboard('{Enter}');
    const notice = await within(dialog).findByTestId('closure-notice');
    expect(notice).toHaveTextContent(expected('he', 'account_closure.kept.not_restored_by_choice_nodate'));
  });

  const get = (query = '') => closureRoute.GET(new NextRequest(`http://localhost${CLOSURE_URL}${query}`, { method: 'GET' }));

  it('?userId= / ?user_id= / ?status= are ignored: only the session id is read', async () => {
    world.rows.push({ id: 'x', user_id: OTHER, status: 'locked', renewal_was_on: false, plan_ends_at: null, lock_at: null, lock_timezone: null });
    const res = await get(`?userId=${OTHER}&user_id=${OTHER}&status=locked`);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ closure: null });
    expect(world.statusReadIds).toEqual([SUBJECT]);
  });

  it('no-store on 200, 401 and 503; 401 when signed out; 503 when the read fails', async () => {
    const ok = await get();
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('no-store');

    mockSession.mockResolvedValueOnce(null);
    const unauth = await get();
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('cache-control')).toContain('no-store');

    const deps = jest.requireMock('@/lib/business-os/account-deletion/closureStatusDeps') as { closureStatusDeps: () => unknown };
    const spy = jest.spyOn(deps, 'closureStatusDeps').mockReturnValueOnce({
      readOpen: async () => ({ data: null, error: new Error('db down') }),
      readTimezone: async () => ({ ok: true, stored: null }),
    });
    const failed = await get();
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toBe('try_again');
    expect(failed.headers.get('cache-control')).toContain('no-store');
    spy.mockRestore();
  });

  it.each(['pending', 'grace', 'requesting', 'locked'] as const)('a %s row: the answer is byte-identical with the switch off, unset and on', async (status) => {
    world.rows.push({ id: 'r', user_id: SUBJECT, status, renewal_was_on: true, plan_ends_at: ENDS, lock_at: status === 'grace' || status === 'locked' ? '2026-11-18T22:00:00.000Z' : null, lock_timezone: status === 'grace' || status === 'locked' ? 'Asia/Jerusalem' : null });
    const bodies: unknown[] = [];
    for (const value of ['true', 'false', undefined]) {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      const res = await get();
      expect(res.status).toBe(200);
      const json = await res.json();
      delete json.correlationId;
      bodies.push(json);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect((bodies[0] as { data: { closure: { status: string } } }).data.closure.status).toBe(status);
  });
});

// ── 5. Edge cases through the real routes ───────────────────────────────────
describe('5. edge cases (real routes)', () => {
  it('a free account → grace right away: the stored lock date in its zone, Keep → not_needed', async () => {
    world.billing = null;
    const { user, dialog } = await requestByKeyboard('en');
    const body = await within(dialog).findByTestId('closure-pending-body');
    expect(sent(DELETE_URL)[0]).toMatchObject({ status: 200, answer: { data: { status: 'grace', lockTimezone: 'Asia/Jerusalem' } } });
    const row = world.rows[0];
    expect(row.status).toBe('grace');
    const lockDate = formatAccountDay(row.lock_at!, 'en', 'Asia/Jerusalem')!;
    expect(body).toHaveTextContent(expected('en', 'account_closure.grace_body', { lockDate }));
    await tabTo(user, within(dialog).getByRole('button', { name: 'Keep my account' }));
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByTestId('closure-notice')).toHaveTextContent(expected('en', 'account_closure.kept.not_needed'));
  });

  it('an owner on a trial → a pending request with the trial end as the plan end; Keep restores the renewal', async () => {
    world.billing = { ...RENEWING, subscriptionStatus: 'trialing' };
    const { user, dialog } = await requestByKeyboard('es');
    const body = await within(dialog).findByTestId('closure-pending-body');
    expect(world.rows[0]).toMatchObject({ status: 'pending', renewal_was_on: true, plan_ends_at: ENDS });
    expect(body.textContent).toContain(formatAccountDay(ENDS, 'es', 'Asia/Jerusalem')!);
    noRawKeyOrSlot(body);
    await tabTo(user, within(dialog).getByRole('button', { name: 'Mantener mi cuenta' }));
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByTestId('closure-notice')).toHaveTextContent(expected('es', 'account_closure.kept.restored'));
  });

  it('a row stuck in requesting (P-8): "couldn\'t confirm", then the re-read shows the W-10 support line and no Keep', async () => {
    world.pendingTransitionFails = true;
    const { dialog } = await requestByKeyboard('en');
    const body = await within(dialog).findByTestId('closure-pending-body');
    expect(sent(DELETE_URL)[0]).toMatchObject({ status: 503, answer: { error: 'try_again', data: { status: 'requesting' } } });
    expect(body).toHaveTextContent(expected('en', 'account_closure.requesting_body'));
    expect(within(body).getByRole('link', { name: PLACEHOLDER_ERASURE_CONTACT })).toHaveAttribute('dir', 'ltr');
    expect(within(dialog).queryByTestId('keep-account-button')).toBeNull();
  });

  it('a locked row → the closed line with the support address, no Keep; the real Keep route would refuse it', async () => {
    world.rows.push({ id: 'l', user_id: SUBJECT, status: 'locked', renewal_was_on: false, plan_ends_at: ENDS, lock_at: '2026-11-18T22:00:00.000Z', lock_timezone: 'Asia/Jerusalem' });
    mockLang.language = 'he';
    render(<SettingsDialog />);
    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    const body = await within(dialog).findByTestId('closure-pending-body');
    expect(body).toHaveTextContent(expected('he', 'account_closure.locked_body'));
    expect(within(dialog).queryByTestId('keep-account-button')).toBeNull();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
    const res = await keepRoute.POST(new NextRequest(`http://localhost${KEEP_URL}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('locked');
  });

  it('CR-6 for real: the insert races another tab, already_requested comes back with data.status null, the re-read finds nothing → the already line', async () => {
    world.insertAlreadyOpen = true;
    const { dialog } = await requestByKeyboard('en');
    const alert = await within(dialog).findByRole('alert');
    expect(sent(DELETE_URL)[0]).toMatchObject({ status: 409, answer: { error: 'already_requested', data: { status: null } } });
    await waitFor(() => expect(alert).toHaveTextContent(expected('en', 'settings.account_delete.already_requested')));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('alert')));
  });

  it('a network failure mid-request → "couldn\'t confirm"; the re-read (real route) finds nothing, and the form is usable again', async () => {
    interceptor = (url) => (url === DELETE_URL ? 'offline' : undefined);
    const { dialog } = await requestByKeyboard('en');
    const alert = await within(dialog).findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent(expected('en', 'settings.account_delete.unconfirmed')));
    expect(sent(CLOSURE_URL).length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByRole('button', { name: 'Delete my account forever' })).toBeEnabled();
    expect(world.rows).toEqual([]);
  });

  it('double submit: Enter twice and a click while in flight → ONE request reaches the route', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    interceptor = (url) => (url === DELETE_URL ? held : undefined);
    const { user, dialog } = await requestByKeyboard('en');
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === DELETE_URL)).toHaveLength(1));
    const button = within(dialog).getByRole('button', { name: translations.en['settings.account_delete.requesting'] });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}');
    await user.click(button);
    await act(async () => release());
    await within(dialog).findByTestId('closure-pending-body');
    expect(fetchMock.mock.calls.filter(([u]) => u === DELETE_URL)).toHaveLength(1);
    expect(world.rows).toHaveLength(1);
  });

  it('double Keep: Enter, Enter and a click while in flight → ONE Keep reaches the route', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { user, dialog } = await requestByKeyboard('en');
    await within(dialog).findByTestId('closure-pending-body');
    interceptor = (url) => (url === KEEP_URL ? held : undefined);
    const keep = within(dialog).getByTestId('keep-account-button');
    await tabTo(user, keep);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(keep).toHaveAttribute('aria-disabled', 'true'));
    expect(document.activeElement).toBe(keep);
    await user.keyboard('{Enter}');
    await user.click(keep);
    await act(async () => release());
    await within(dialog).findByTestId('closure-notice');
    expect(fetchMock.mock.calls.filter(([u]) => u === KEEP_URL)).toHaveLength(1);
  });

  it('Keep pressed again while the state_changed re-read is in flight, and the stale re-read lands last → the kept line still wins', async () => {
    const { user, dialog } = await requestByKeyboard('en');
    await within(dialog).findByTestId('closure-pending-body');
    // Another tab (or the mirror) moves the row from pending to grace just before our Keep lands.
    const keepDeps = jest.requireMock('@/lib/business-os/account-deletion/closureKeepDeps') as { closureKeepDeps: () => Record<string, unknown> };
    const real = keepDeps.closureKeepDeps;
    const spy = jest.spyOn(keepDeps, 'closureKeepDeps').mockImplementationOnce(() => {
      const deps = real() as { closures: Record<string, unknown> };
      return {
        ...deps,
        closures: {
          ...deps.closures,
          transition: async () => {
            world.rows[0].status = 'grace';
            world.rows[0].lock_at = '2026-12-09T22:00:00.000Z';
            world.rows[0].lock_timezone = 'Asia/Jerusalem';
            return { data: false, error: null };
          },
        },
      };
    });
    // Hold the closure re-read that follows state_changed; its answer is worked out NOW (open, stale).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holdNext = false;
    interceptor = (url) => {
      if (url === KEEP_URL) holdNext = true;
      else if (url === CLOSURE_URL && holdNext) {
        holdNext = false;
        return held;
      }
      return undefined;
    };
    const keep = within(dialog).getByTestId('keep-account-button');
    await tabTo(user, keep);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent(KEEP_URL)).toHaveLength(1));
    expect(sent(KEEP_URL)[0]).toMatchObject({ status: 409, answer: { error: 'state_changed', data: { status: 'grace' } } });
    spy.mockRestore();
    interceptor = null;

    // The re-read is still in flight: Keep is still there (the old pending view); press it again.
    expect(within(dialog).getByTestId('keep-account-button')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const notice = await within(dialog).findByTestId('closure-notice');
    expect(notice).toHaveTextContent(expected('en', 'account_closure.kept.not_needed'));
    expect(world.rows[0].status).toBe('kept');

    // Now the stale "grace, open" read lands: the kept line must not be replaced by a pending view.
    await act(async () => release());
    await waitFor(() => expect(sent(CLOSURE_URL).length).toBeGreaterThanOrEqual(3));
    expect(within(dialog).getByTestId('closure-notice')).toHaveTextContent(expected('en', 'account_closure.kept.not_needed'));
    expect(within(dialog).queryByTestId('keep-account-button')).toBeNull();
    expect(sent(KEEP_URL)).toHaveLength(2);
  });
});
