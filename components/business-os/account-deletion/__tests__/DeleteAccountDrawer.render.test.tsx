/**
 * @jest-environment jsdom
 *
 * The deletion request form (data export DE-10b.2; account deletion lifecycle
 * DL-2a, DL-2 workplan §5.3, §5.4, §8, §12 T-2, T-3; requirement §3.3, §10.1;
 * SA V-8, W-13). Rendered with dictionary strings in English and Hebrew.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockControl = jest.fn((props: { variant: string }) => <div data-testid="download-my-data" data-variant={props.variant} />);
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: (props: { variant: string }) => mockControl(props),
}));

import fs from 'fs';
import path from 'path';
import { DeleteAccountDrawer, blockerCopyKey, parseBlockers, type ClosureRereadResult, type CopyFn } from '../DeleteAccountDrawer';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';

const dictionaryCopy =
  (dictionary: Record<string, string>): CopyFn =>
  (key, vars) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

const READY: EnabledDeletionCheck = {
  enabled: true,
  available: true,
  blockers: [],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
};

const fetchMock = jest.fn();
const onRequestAnswered = jest.fn<Promise<ClosureRereadResult>, unknown[]>();

function renderDrawer(check: Partial<EnabledDeletionCheck> = {}, language = 'en') {
  const dictionary = (language === 'he' ? he : en) as unknown as Record<string, string>;
  return render(
    <DeleteAccountDrawer
      check={{ ...READY, ...check }}
      tr={dictionaryCopy(dictionary)}
      language={language}
      isRTL={language === 'he'}
      onRequestAnswered={onRequestAnswered}
    />
  );
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  mockControl.mockClear();
  onRequestAnswered.mockReset().mockResolvedValue('open');
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

const box = () => screen.getByLabelText(en['settings.account_delete.statement_label']);
const button = () => screen.getByRole('button', { name: en['settings.account_delete.request_button'] });
const pick = (code = 'too_expensive') => fireEvent.click(screen.getByTestId(`delete-account-reason-${code}`));

async function submitReady(code = 'too_expensive') {
  pick(code);
  fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
  await act(async () => {
    fireEvent.click(button());
  });
}

describe('section 1: export first (S-4, SR-9, BQ-35)', () => {
  it('exactly one shared DownloadMyDataButton, the button variant, and no export link or fetch of its own', () => {
    const { container } = renderDrawer();
    const controls = screen.getAllByTestId('download-my-data');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('data-variant', 'button');
    expect(container.querySelector('a[href*="export"]')).toBeNull();
    expect(screen.getByText(en['settings.account_delete.export_first.heading'])).toBeInTheDocument();
    expect(screen.getByText(en['settings.account_delete.export_first.documents'])).toBeInTheDocument();
    expect(screen.getByTestId('download-my-data').closest('.flex-row-reverse')).toBeNull();
    const source = fs.readFileSync(path.join(__dirname, '..', 'DeleteAccountDrawer.tsx'), 'utf8');
    expect(source).not.toMatch(/data-export['"`]|export-requests/);
  });

  it('the control is shown even while blocked or not available', () => {
    renderDrawer({ blockers: [{ code: 'payment_failed' }] });
    expect(screen.getAllByTestId('download-my-data')).toHaveLength(1);
  });

  it('no mailto outside the blocker, not-available and failure lines', () => {
    const { container } = renderDrawer();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('the old "will be deleted now" line is gone (it is false since DL-1b)', () => {
    const { container } = renderDrawer();
    expect(container.textContent).not.toContain('Your account will be deleted now.');
  });
});

describe('the warning in English and Hebrew', () => {
  it('English, left to right', () => {
    renderDrawer();
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(en['settings.account_delete.warning'])).toBeInTheDocument();
  });

  it('Hebrew, right to left, the Hebrew statement shown and its box RTL, the reasons in Hebrew', () => {
    renderDrawer({}, 'he');
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(he['settings.account_delete.warning'])).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-statement')).toHaveTextContent(DELETION_STATEMENTS.he);
    expect(screen.getByLabelText(he['settings.account_delete.statement_label'])).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(he['settings.plan_cancel.reason.heading'])).toBeInTheDocument();
    expect(screen.getByLabelText(he['settings.plan_cancel.reason.too_expensive'])).toBeInTheDocument();
  });

  it('the billing-kept line only when the check says so, and it does not claim real money was paid', () => {
    renderDrawer();
    expect(screen.queryByText(en['settings.account_delete.billing_kept'])).toBeNull();
  });

  it('the billing-kept line wording (DE-10b.1 QA I-a)', () => {
    renderDrawer({ willKeepBilling: true });
    const text = screen.getByText(en['settings.account_delete.billing_kept']).textContent ?? '';
    expect(text).not.toMatch(/real money|you paid/i);
  });
});

describe('section 3: the reason (BQ-32, D-5, W-13)', () => {
  it('a fieldset with the cancel heading, the seven reasons in order, none picked, the required line shown', () => {
    renderDrawer();
    const group = screen.getByRole('group', { name: en['settings.plan_cancel.reason.heading'] });
    const radios = Array.from(group.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([...PLAN_LEAVE_REASON_CODES]);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(screen.getByTestId('delete-account-reason-required')).toHaveTextContent(en['settings.plan_cancel.reason.required']);
    for (const code of PLAN_LEAVE_REASON_CODES) expect(screen.getByLabelText(en[`settings.plan_cancel.reason.${code}` as keyof typeof en])).toBeInTheDocument();
  });

  it('the button stays disabled with the statement typed but no reason, and names the required line', () => {
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    expect(button()).toBeDisabled();
    const requiredId = screen.getByTestId('delete-account-reason-required').id;
    expect(button().getAttribute('aria-describedby')).toContain(requiredId);
    pick();
    expect(button()).toBeEnabled();
    expect(screen.queryByTestId('delete-account-reason-required')).toBeNull();
  });

  it('Enter in the box with no reason sends nothing (never `other` by default)', async () => {
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Enter' });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('section 4: the statement box', () => {
  it('has a label; the button stays disabled until the statement matches', () => {
    renderDrawer();
    pick();
    expect(button()).toBeDisabled();
    fireEvent.change(box(), { target: { value: 'I have exported my data' } });
    expect(button()).toBeDisabled();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en.toUpperCase() } });
    expect(button()).toBeEnabled();
  });

  it('a pasted match enables it (no paste block)', () => {
    renderDrawer();
    pick();
    const pasted = fireEvent.paste(box(), { clipboardData: { getData: () => DELETION_STATEMENTS.en } });
    expect(pasted).toBe(true);
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    expect(button()).toBeEnabled();
  });

  it('the English statement enables the button in the Hebrew UI; the label is today\'s (Q-7)', () => {
    renderDrawer({}, 'he');
    fireEvent.click(screen.getByTestId('delete-account-reason-other'));
    fireEvent.change(screen.getByLabelText(he['settings.account_delete.statement_label']), { target: { value: DELETION_STATEMENTS.en } });
    expect(screen.getByRole('button', { name: 'מחיקת החשבון שלי לצמיתות' })).toBeEnabled();
    expect(en['settings.account_delete.request_button']).toBe('Delete my account forever');
  });
});

describe('blockers and availability (section 2)', () => {
  it('blockers → listed in plain words with the support mailto, and no reason, no box, no button', () => {
    renderDrawer({ blockers: [{ code: 'plan_running' }, { code: 'client_plans_running', count: 2 }, { code: 'contact_support' }] });
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
    expect(screen.queryByRole('group', { name: en['settings.plan_cancel.reason.heading'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['settings.account_delete.request_button'] })).toBeNull();
    const list = screen.getByTestId('delete-account-blockers');
    expect(list).toHaveTextContent('Your plan is still running. Cancel it in Settings → Plan.');
    expect(list).toHaveTextContent('We need to finish something on our side first. Contact us at');
    expect(list).toHaveTextContent('2 client payment plans are still running');
    expect(list.querySelector(`a[href="mailto:${PLACEHOLDER_ERASURE_CONTACT}"]`)).not.toBeNull();
  });

  it('T-3: payment_failed has its own line with the support mailto, never a raw key', () => {
    renderDrawer({ blockers: [{ code: 'payment_failed' }] });
    const list = screen.getByTestId('delete-account-blockers');
    expect(list).toHaveTextContent('Your last plan payment failed. Update your card in Settings → Plan, or contact us at');
    expect(list.textContent).not.toContain('settings.account_delete');
    expect(list.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });

  it('available: false → the not-available line with the support address, no box', () => {
    const { container } = renderDrawer({ available: false });
    expect(container.textContent).toContain('Deleting your account is not available right now');
    expect(container.querySelector(`a[href="mailto:${PLACEHOLDER_ERASURE_CONTACT}"]`)).not.toBeNull();
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
  });
});

describe('T-2: submitting', () => {
  it('posts exactly { statement, language, reasonCode }; a recorded request is handed to the host; no navigation', async () => {
    respond(200, { success: true, data: { status: 'pending', planEndsOn: '2026-11-26T10:00:00.000Z', renewalWasOn: true } });
    renderDrawer();
    await submitReady('business_closing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/business-os/account/delete');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    expect(JSON.parse(init.body)).toEqual({ statement: DELETION_STATEMENTS.en, language: 'en', reasonCode: 'business_closing' });
    await waitFor(() => expect(onRequestAnswered).toHaveBeenCalledWith({ kind: 'recorded' }));
    const source = fs.readFileSync(path.join(__dirname, '..', 'DeleteAccountDrawer.tsx'), 'utf8');
    expect(source).not.toMatch(/signOutUser|location\.replace|ACCOUNT_DELETED_PATH|isAccountDeletedRedirect/);
  });

  it('Enter in the box submits once the reason and the statement are set', async () => {
    respond(200, { success: true, data: { status: 'grace', lockAt: '2026-12-01T22:00:00.000Z', lockTimezone: 'UTC' } });
    renderDrawer();
    pick('other');
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Enter' });
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasonCode).toBe('other');
  });

  it('a recorded request the re-read cannot find → "couldn\'t confirm"', async () => {
    respond(200, { success: true, data: { status: 'pending', planEndsOn: null, renewalWasOn: false } });
    onRequestAnswered.mockResolvedValue('none');
    renderDrawer();
    await submitReady();
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't confirm your request yet.");
  });

  it('no double submit while requesting', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDrawer();
    await submitReady();
    const busy = screen.getByRole('button', { name: en['settings.account_delete.requesting'] });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: false, status: 503, json: async () => ({ error: 'try_again' }) });
    });
  });

  it.each([
    [400, { error: 'statement_mismatch' }, en['settings.account_delete.mismatch']],
    [409, { error: 'plan_change_pending' }, en['settings.account_delete.plan_change_pending']],
    [409, { error: 'plan_state_changed' }, en['settings.account_delete.plan_state_changed']],
    [429, { error: 'Too many requests' }, en['settings.account_delete.too_many']],
    [404, { error: 'not_found' }, 'Deleting your account is not available right now'],
    [503, { error: 'try_again' }, 'We could not record your request, and nothing has changed.'],
    [401, { error: 'Unauthorized' }, en['plan.refusal.signed_out']],
  ])('%s %j → its line in role="alert", the host not asked to re-read', async (status, body, text) => {
    respond(status, { success: false, ...body });
    renderDrawer();
    await submitReady();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(button().getAttribute('aria-describedby')).toContain(alert.id);
    expect(onRequestAnswered).not.toHaveBeenCalled();
    // SA CR-2: the focused control was disabled in flight, so focus moves to the line that explains the answer.
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(alert).toHaveAttribute('tabindex', '-1');
  });

  it('SA CR-2: focus leaves the disabled button for the alert (409 plan_change_pending, button focused first)', async () => {
    respond(409, { success: false, error: 'plan_change_pending' });
    renderDrawer();
    pick();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    button().focus();
    await act(async () => {
      fireEvent.click(button());
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en['settings.account_delete.plan_change_pending']);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('SA CR-2: a network failure whose re-read finds nothing → focus on the "couldn\'t confirm" line', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    onRequestAnswered.mockResolvedValue('none');
    renderDrawer();
    await submitReady();
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('a network failure → "couldn\'t confirm", then the host re-reads', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    onRequestAnswered.mockResolvedValue('none');
    renderDrawer();
    await submitReady();
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't confirm your request yet.");
    expect(onRequestAnswered).toHaveBeenCalledWith({ kind: 'unconfirmed' });
  });

  it('a 409 blocked re-renders the server blockers, payment_failed included, with no box', async () => {
    respond(409, { success: false, error: 'blocked', blockers: [{ code: 'stripe_connected' }, { code: 'payment_failed' }] });
    renderDrawer();
    await submitReady();
    const list = await screen.findByTestId('delete-account-blockers');
    expect(list).toHaveTextContent('Your Stripe account is still linked for client payments. Remove it in Business Setup');
    expect(list).toHaveTextContent('Your last plan payment failed.');
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
    // SA CR-2: the form that held focus is gone, so focus moves to the blockers heading.
    const heading = screen.getByTestId('delete-account-blockers-title');
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('the button is reachable by keyboard (a real button in the tab order)', () => {
    renderDrawer();
    pick();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    button().focus();
    expect(document.activeElement).toBe(button());
    expect(button()).toHaveAttribute('type', 'submit');
  });
});

describe('SA code review N-1, N-3', () => {
  it('N-1: parseBlockers falls back to contact_support for an empty, unreadable or unknown list', () => {
    expect(parseBlockers([])).toEqual([{ code: 'contact_support' }]);
    expect(parseBlockers(undefined)).toEqual([{ code: 'contact_support' }]);
    expect(parseBlockers([{ code: 'something_new' }])).toEqual([{ code: 'contact_support' }]);
    expect(parseBlockers([{ code: 'stripe_connected' }, { code: 'client_plans_running', count: 2 }])).toEqual([
      { code: 'stripe_connected' },
      { code: 'client_plans_running', count: 2 },
    ]);
  });

  it('N-1: a 409 with an empty blocker list still shows a blocker and no statement box', async () => {
    respond(409, { success: false, error: 'blocked', blockers: [] });
    renderDrawer();
    await submitReady();
    expect(await screen.findByTestId('delete-account-blockers')).toHaveTextContent('We need to finish something on our side first');
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
  });

  it('N-3: a counted blocker without a count renders its uncounted copy, never an empty number', () => {
    expect(blockerCopyKey({ code: 'client_plans_running' })).toBe('settings.account_delete.blocker.client_plans_running_uncounted');
    expect(blockerCopyKey({ code: 'client_plans_running', count: 3 })).toBe('settings.account_delete.blocker.client_plans_running');
    expect(blockerCopyKey({ code: 'plan_running' })).toBe('settings.account_delete.blocker.plan_running');
    expect(blockerCopyKey({ code: 'payment_failed' })).toBe('settings.account_delete.blocker.payment_failed');
    renderDrawer({ blockers: [{ code: 'client_plans_running' }, { code: 'client_payments_pending' }] });
    const list = screen.getByTestId('delete-account-blockers');
    expect(list).toHaveTextContent(en['settings.account_delete.blocker.client_plans_running_uncounted']);
    expect(list).toHaveTextContent(en['settings.account_delete.blocker.client_payments_pending_uncounted']);
    expect(list.textContent).not.toMatch(/\{n\}|^\s|  client/);
  });

  it('N-3: the uncounted keys exist in the dictionaries', () => {
    for (const dictionary of [en, he] as unknown as Array<Record<string, string>>) {
      expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).toBeTruthy();
      expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).not.toContain('{n}');
    }
  });
});
