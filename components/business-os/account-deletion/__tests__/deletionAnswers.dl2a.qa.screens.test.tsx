/**
 * @jest-environment jsdom
 *
 * QA, DL-2a (DL-2 workplan § QA Testing Report (DL-2a), items 2, 6, 7).
 *
 * 2. EVERY answer of the request route and of the Keep route, rendered in the
 *    real Danger Zone dialog host in en, he and es, must put the language's own
 *    dictionary line on screen: never a raw key, never an empty line, never an
 *    unfilled `{slot}`, and never the English fallback in he / es (the host's
 *    `tr()` falls back to English silently when a key is missing, so the text
 *    is compared with the language's own line).
 * 6. The checkout, Boost and plan-page reactivate refusals for
 *    `deletion_pending` read the deletion line, never a "try again later" one.
 * 7. Copy: no line promises an email; no added line holds a backslash
 *    (Tailwind scans the repo); he / es slot parity with en.
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const dictionaries: Record<string, Record<string, string>> = {
    en: jest.requireActual('@/lib/business-os/translations/en').en,
    he: jest.requireActual('@/lib/business-os/translations/he').he,
    es: jest.requireActual('@/lib/business-os/translations/es').es,
  };
  // The provider's `t`: the line or the key itself, then `{name}` slots.
  const t = (key: string, vars?: Record<string, string | number>) => {
    let text = dictionaries[mockLang.language][key] || key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };
  const value = () => ({ language: mockLang.language, isRTL: mockLang.language === 'he', timezone: 'UTC', t });
  return { useOptionalLanguage: value, useLanguage: value };
});

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { ErasureDialogBody } from '@/components/business-os/purge/DangerZonePanel';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import { planManageRefusalKey } from '@/components/business-os/settings/planManageCopy';
import { planPurchaseRefusalKey } from '@/components/business-os/settings/planPurchaseCopy';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const DICTS = { en, he, es } as unknown as Record<Lang, Record<string, string>>;
const LANGS: Lang[] = ['en', 'he', 'es'];

const CLOSURE_URL = '/api/business-os/account/closure';
const CHECK_URL = '/api/business-os/account/deletion-check';
const KEEP_URL = '/api/business-os/account/keep';
const DELETE_URL = '/api/business-os/account/delete';
const ENDS = '2026-11-26T10:00:00.000Z';
const READY = { enabled: true, available: true, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };
const PENDING = { status: 'pending', planEndsAt: ENDS, lockAt: '2026-12-09T22:00:00.000Z', lockAtIsProjected: true, timezone: 'Asia/Jerusalem', renewalWasOn: true, graceDays: 14 };
const LOCKED = { status: 'locked', planEndsAt: ENDS, lockAt: '2026-12-09T22:00:00.000Z', lockAtIsProjected: false, timezone: 'Asia/Jerusalem', renewalWasOn: true, graceDays: 14 };

type Reply = { status: number; body: unknown } | 'network';
let closureReplies: unknown[];
let deleteReply: Reply;
let keepReply: Reply;
const fetchMock = jest.fn();

function respond(reply: Reply) {
  if (reply === 'network') return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body });
}

beforeEach(() => {
  mockLang.language = 'en';
  mockRefresh.mockReset();
  closureReplies = [null];
  deleteReply = { status: 500, body: {} };
  keepReply = { status: 500, body: {} };
  fetchMock.mockReset().mockImplementation((url: string) => {
    if (url === CLOSURE_URL) {
      const closure = closureReplies.length > 1 ? closureReplies.shift() : closureReplies[0];
      return respond({ status: 200, body: { success: true, data: { closure } } });
    }
    if (url === CHECK_URL) return respond({ status: 200, body: { success: true, data: READY } });
    if (url === DELETE_URL) return respond(deleteReply);
    if (url === KEEP_URL) return respond(keepReply);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

/** The language's own line as read on screen: slots filled, `{support}` as the mailto's text. */
function expected(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const template = DICTS[lang][key];
  if (typeof template !== 'string' || template.trim() === '') throw new Error(`${lang}: no line for ${key}`);
  let text = template;
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text.split('{support}').join(PLACEHOLDER_ERASURE_CONTACT);
}

function assertClean(element: HTMLElement, lang: Lang, key: string, vars?: Record<string, string | number>) {
  const text = (element.textContent ?? '').trim();
  expect(text).not.toBe('');
  expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
  expect(text).not.toMatch(/\b(settings|account_closure|plan)\.[a-z_]+\./);
  expect(text).toBe(expected(lang, key, vars).trim());
  if (lang !== 'en') expect(text).not.toBe(expected('en', key, vars).trim());
}

async function openDialog(lang: Lang) {
  mockLang.language = lang;
  render(
    <Dialog>
      <DialogTrigger>Open delete</DialogTrigger>
      <DialogContent>
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open delete' }));
  return screen.findByRole('dialog');
}

async function submitRequest(lang: Lang) {
  const dialog = await openDialog(lang);
  fireEvent.click(await within(dialog).findByTestId('delete-account-reason-missing_feature'));
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: DELETION_STATEMENTS[lang] } });
  fireEvent.click(within(dialog).getByRole('button', { name: DICTS[lang]['settings.account_delete.request_button'] }));
  return dialog;
}

// ── 2a. Every request answer → a line on screen ─────────────────────────────
type RequestRow = [label: string, reply: Reply, key: string];
const REQUEST_ROWS: RequestRow[] = [
  ['200 pending, the re-read finds nothing', { status: 200, body: { success: true, data: { status: 'pending', planEndsOn: ENDS, renewalWasOn: true } } }, 'settings.account_delete.unconfirmed'],
  ['200 grace, the re-read finds nothing', { status: 200, body: { success: true, data: { status: 'grace', lockAt: ENDS, lockTimezone: 'UTC' } } }, 'settings.account_delete.unconfirmed'],
  ['200 with a body we cannot read', { status: 200, body: { success: true, data: { status: 'odd' } } }, 'settings.account_delete.unconfirmed'],
  ['409 already_requested (pending), the re-read finds nothing', { status: 409, body: { success: false, error: 'already_requested', data: { status: 'pending' } } }, 'settings.account_delete.already_requested'],
  ['409 already_requested with status null (CR-6)', { status: 409, body: { success: false, error: 'already_requested', data: { status: null } } }, 'settings.account_delete.already_requested'],
  ['409 plan_change_pending', { status: 409, body: { success: false, error: 'plan_change_pending' } }, 'settings.account_delete.plan_change_pending'],
  ['409 plan_state_changed', { status: 409, body: { success: false, error: 'plan_state_changed' } }, 'settings.account_delete.plan_state_changed'],
  ['400 statement_mismatch', { status: 400, body: { success: false, error: 'statement_mismatch' } }, 'settings.account_delete.mismatch'],
  ['400 invalid_body', { status: 400, body: { success: false, error: 'invalid_body' } }, 'settings.account_delete.try_again'],
  ['413 body_too_large', { status: 413, body: { success: false, error: 'body_too_large' } }, 'settings.account_delete.try_again'],
  ['429', { status: 429, body: { error: 'Too many requests' } }, 'settings.account_delete.too_many'],
  ['404 not_found (switch went off)', { status: 404, body: { success: false, error: 'not_found' } }, 'settings.account_delete.not_available'],
  ['503 not_available', { status: 503, body: { success: false, error: 'not_available' } }, 'settings.account_delete.not_available'],
  ['503 try_again', { status: 503, body: { success: false, error: 'try_again' } }, 'settings.account_delete.try_again'],
  ['503 try_again + requesting (P-8)', { status: 503, body: { success: false, error: 'try_again', data: { status: 'requesting' } } }, 'settings.account_delete.unconfirmed'],
  ['502 stripe_error + outcomeUnknown', { status: 502, body: { success: false, error: 'stripe_error', outcomeUnknown: true } }, 'settings.account_delete.unconfirmed'],
  ['502 stripe_error', { status: 502, body: { success: false, error: 'stripe_error' } }, 'settings.account_delete.try_again'],
  ['500 request_failed', { status: 500, body: { success: false, error: 'request_failed' } }, 'settings.account_delete.unconfirmed'],
  ['500 with no code', { status: 500, body: { success: false, error: 'Internal server error' } }, 'settings.account_delete.unconfirmed'],
  ['418 unknown client error', { status: 418, body: {} }, 'settings.account_delete.try_again'],
  ['401', { status: 401, body: { success: false, error: 'Unauthorized' } }, 'plan.refusal.signed_out'],
  ['a network failure', 'network', 'settings.account_delete.unconfirmed'],
];

describe.each(LANGS)('2. request answers in %s', (lang) => {
  it.each(REQUEST_ROWS)('%s → its line', async (_label, reply, key) => {
    deleteReply = reply;
    const dialog = await submitRequest(lang);
    const alert = await within(dialog).findByRole('alert');
    await waitFor(() => assertClean(alert, lang, key));
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it.each([
    ['payment_failed', 'settings.account_delete.blocker.payment_failed'],
    ['plan_running', 'settings.account_delete.blocker.plan_running'],
    ['an unknown code → contact_support', 'settings.account_delete.blocker.contact_support'],
  ])('409 blocked: %s', async (code, key) => {
    deleteReply = { status: 409, body: { success: false, error: 'blocked', blockers: [{ code: code.startsWith('an unknown') ? 'brand_new_code' : code }] } };
    const dialog = await submitRequest(lang);
    const title = await within(dialog).findByTestId('delete-account-blockers-title');
    assertClean(title, lang, 'settings.account_delete.blockers_title');
    const items = within(within(dialog).getByTestId('delete-account-blockers')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    assertClean(items[0], lang, key);
    await waitFor(() => expect(document.activeElement).toBe(title));
  });
});

// ── 2b. Every Keep answer → a line on screen ────────────────────────────────
// Always five members: a shorter row would make Jest pass `done` as the last argument.
type KeepRow = [label: string, reply: Reply, where: 'notice' | 'refusal' | 'body', key: string, vars: ((lang: Lang) => Record<string, string>) | null];
const KEEP_ROWS: KeepRow[] = [
  ['200 restored', { status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'restored' } } }, 'notice', 'account_closure.kept.restored', null],
  ['200 not_restored_by_choice', { status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'not_restored_by_choice' } } }, 'notice', 'account_closure.kept.not_restored_by_choice', (lang) => ({ planEnd: formatAccountDay(ENDS, lang, 'Asia/Jerusalem')! })],
  ['200 not_needed', { status: 200, body: { success: true, data: { kept: true, from: 'grace', renewal: 'not_needed' } } }, 'notice', 'account_closure.kept.not_needed', null],
  ['200 failed', { status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'failed', code: 'stripe_error', planEndsOn: ENDS } } }, 'notice', 'account_closure.kept.failed', null],
  ['200 unknown', { status: 200, body: { success: true, data: { kept: true, from: 'pending', renewal: 'unknown' } } }, 'notice', 'account_closure.kept.unknown', null],
  ['200 with a body we cannot read', { status: 200, body: { success: true } }, 'notice', 'account_closure.kept.generic', null],
  ['409 state_changed + kept (CR-8)', { status: 409, body: { success: false, error: 'state_changed', data: { status: 'kept' } } }, 'notice', 'account_closure.kept.generic', null],
  ['409 nothing_to_keep', { status: 409, body: { success: false, error: 'nothing_to_keep' } }, 'notice', 'account_closure.nothing_to_keep', null],
  ['409 request_in_progress', { status: 409, body: { success: false, error: 'request_in_progress', data: { status: 'requesting' } } }, 'refusal', 'account_closure.requesting_body', null],
  ['409 locked', { status: 409, body: { success: false, error: 'locked', data: { status: 'locked' } } }, 'refusal', 'account_closure.locked_body', null],
  ['429', { status: 429, body: { error: 'Too many requests' } }, 'refusal', 'settings.account_delete.too_many', null],
  ['401', { status: 401, body: { success: false, error: 'Unauthorized' } }, 'refusal', 'plan.refusal.signed_out', null],
  ['400 invalid_body', { status: 400, body: { success: false, error: 'invalid_body' } }, 'refusal', 'account_closure.keep_failed', null],
  ['503 try_again', { status: 503, body: { success: false, error: 'try_again' } }, 'refusal', 'account_closure.keep_failed', null],
  ['500', { status: 500, body: { success: false, error: 'Internal server error' } }, 'refusal', 'account_closure.keep_failed', null],
  ['a network failure', 'network', 'refusal', 'account_closure.keep_failed', null],
  ['409 state_changed + locked → the re-read shows the new state', { status: 409, body: { success: false, error: 'state_changed', data: { status: 'locked' } } }, 'body', 'account_closure.locked_body', null],
];

describe.each(LANGS)('2. Keep answers in %s', (lang) => {
  it.each(KEEP_ROWS)('%s → its line', async (_label, reply, where, key, vars) => {
    keepReply = reply;
    // The panel's read, then the re-read after Keep (none, or the new state).
    closureReplies = [PENDING, where === 'body' ? LOCKED : null];
    const dialog = await openDialog(lang);
    await within(dialog).findByTestId('closure-pending-body');
    fireEvent.click(within(dialog).getByRole('button', { name: DICTS[lang]['account_closure.keep_button'] }));
    const testId = where === 'notice' ? 'closure-notice' : where === 'refusal' ? 'closure-keep-refusal' : null;
    if (testId) {
      const line = await within(dialog).findByTestId(testId);
      assertClean(line, lang, key, vars?.(lang));
      await waitFor(() => expect(document.activeElement).toBe(line));
    } else {
      await waitFor(() => expect(within(dialog).getByTestId('closure-pending-panel')).toHaveAttribute('data-status', 'locked'));
      const body = within(dialog).getByTestId('closure-pending-body');
      assertClean(body, lang, key);
      expect(within(dialog).queryByTestId('closure-keep-refusal')).toBeNull();
    }
  });
});

// ── 6. deletion_pending on the checkout, Boost and reactivate ───────────────
describe('6. the checkout, Boost and reactivate refusals for deletion_pending', () => {
  const TRY_LATER_KEYS = ['plan.manage.refusal.unavailable', 'plan.refusal.not_open', 'plan.refusal.generic', 'usage.boost.error.generic', 'plan.manage.refusal.generic'];

  it.each(LANGS)('%s: each maps to its deletion line, never a "try again later" line', (lang) => {
    const lines = {
      reactivate: DICTS[lang][planManageRefusalKey({ httpStatus: 409, code: 'deletion_pending', outcomeUnknown: false })],
      checkout: DICTS[lang][planPurchaseRefusalKey({ httpStatus: 409, code: 'deletion_pending' })],
      boost: DICTS[lang]['usage.boost.error.deletion_pending'],
    };
    expect(lines.reactivate).toBe(DICTS[lang]['plan.manage.refusal.deletion_pending']);
    expect(lines.checkout).toBe(DICTS[lang]['plan.refusal.deletion_pending']);
    for (const text of Object.values(lines)) {
      expect(typeof text).toBe('string');
      expect(text).toContain(DICTS[lang]['account_closure.keep_button']);
      for (const placeholder of TRY_LATER_KEYS) expect(text).not.toBe(DICTS[lang][placeholder]);
    }
  });

  it.each(LANGS)('%s: the plan page "Keep my plan" press refused with the route\'s 409 deletion_pending shows the deletion line', async (lang) => {
    mockLang.language = lang;
    fetchMock.mockReset().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: 'Your account is set to be deleted. Keep your account first.', code: 'deletion_pending' }),
    });
    const plan = {
      status: 'ok',
      kind: 'tier',
      name: 'Essentials',
      purchase: { offer: { kind: 'none', reason: 'paying' }, billing: { state: 'ending', date: '2099-11-26T10:00:00.000Z' }, endsFreeAccessOnPurchase: null, upgrade: null, manage: { cancel: false, reactivate: true, paymentFailed: false } },
    } as unknown as PlanPayload;
    render(<PlanManage plan={plan} />);
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-refused')).toHaveTextContent(DICTS[lang]['plan.manage.refusal.deletion_pending']));
    expect(screen.getByTestId('plan-manage-refused').textContent).not.toContain('Keep your account first.');
  });
});

// ── 7. Copy checks ──────────────────────────────────────────────────────────
describe('7. copy', () => {
  const NAMESPACES = ['settings.account_delete.', 'account_closure.'];
  const CLAIMED = ['plan.manage.refusal.deletion_pending', 'plan.refusal.deletion_pending', 'usage.boost.error.deletion_pending'];
  const ownKeys = Object.keys(DICTS.en).filter((key) => NAMESPACES.some((prefix) => key.startsWith(prefix)) || CLAIMED.includes(key));
  const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('found the keys (not vacuous)', () => {
    expect(ownKeys.length).toBeGreaterThanOrEqual(40);
    expect(ownKeys).toEqual(expect.arrayContaining(['account_closure.pending_body', 'account_closure.kept.restored', ...CLAIMED]));
  });

  it.each(['he', 'es'] as const)('%s: the same keys as en, each non-empty, with the same {slots}', (lang) => {
    for (const key of ownKeys) {
      const line = DICTS[lang][key];
      expect([key, typeof line === 'string' && line.trim() !== '']).toEqual([key, true]);
      expect([key, slots(line)]).toEqual([key, slots(DICTS.en[key])]);
    }
    const extra = Object.keys(DICTS[lang]).filter((key) => NAMESPACES.some((prefix) => key.startsWith(prefix)) && !(key in DICTS.en));
    expect(extra).toEqual([]);
  });

  it('the slots the screens fill are where they should be ({support}, {planEnd}, {lockDate}, {days})', () => {
    for (const lang of LANGS) {
      expect(slots(DICTS[lang]['account_closure.pending_body'])).toEqual(['days', 'lockDate', 'planEnd']);
      expect(slots(DICTS[lang]['account_closure.pending_body_nodate'])).toEqual(['days']);
      expect(slots(DICTS[lang]['account_closure.grace_body'])).toEqual(['lockDate']);
      expect(slots(DICTS[lang]['account_closure.kept.not_restored_by_choice'])).toEqual(['planEnd']);
      for (const key of ['account_closure.requesting_body', 'account_closure.locked_body', 'account_closure.keep_failed', 'settings.account_delete.try_again', 'settings.account_delete.blocker.payment_failed']) {
        expect([lang, key, slots(DICTS[lang][key])]).toEqual([lang, key, ['support']]);
      }
    }
  });

  it('no line promises an email (D-9), in any language', () => {
    const promise = /\b(e-?mail(ed)?|we('ve| have| will|'ll) (sent|send)|sent you)\b|אימייל|מייל|נשלח אליכם|שלחנו|correo|te (hemos )?enviado|te enviaremos/i;
    for (const lang of LANGS) {
      for (const key of ownKeys) {
        expect([lang, key, promise.test(DICTS[lang][key])]).toEqual([lang, key, false]);
      }
    }
  });

  it('no line of these namespaces holds a backslash, in the dictionaries or the DangerZonePanel fallback source', () => {
    const files = ['lib/business-os/translations/en.ts', 'lib/business-os/translations/he.ts', 'lib/business-os/translations/es.ts', 'components/business-os/purge/DangerZonePanel.tsx'];
    let seen = 0;
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const sourceLine of source.split(/\r?\n/)) {
        if (!ownKeys.some((key) => sourceLine.includes(`'${key}'`))) continue;
        seen += 1;
        expect([file, sourceLine.includes('\\')]).toEqual([file, false]);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(ownKeys.length * 3);
  });
});
