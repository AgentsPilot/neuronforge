/**
 * @jest-environment jsdom
 *
 * The self-delete steps (data export DE-10b.2; workplan §4.3; requirement
 * §3.1, §10.1; SA V-4, V-8). Rendered with the English fallback copy, as on
 * /v2/settings, and with Hebrew strings straight from the dictionary.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockSignOut = jest.fn();
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: (...args: unknown[]) => mockSignOut(...args) }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import { DeleteAccountDrawer, blockerCopyKey, parseBlockers, type CopyFn } from '../DeleteAccountDrawer';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
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
const navigate = jest.fn();

function renderDrawer(check: Partial<EnabledDeletionCheck> = {}, language = 'en') {
  const dictionary = (language === 'he' ? he : en) as unknown as Record<string, string>;
  return render(
    <DeleteAccountDrawer check={{ ...READY, ...check }} tr={dictionaryCopy(dictionary)} language={language} isRTL={language === 'he'} navigate={navigate} />
  );
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  navigate.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ ok: true, outcome: 'signed_out', clearedLocally: true });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

const box = () => screen.getByLabelText(en['settings.account_delete.statement_label']);
const button = () => screen.getByRole('button', { name: en['settings.account_delete.delete_button'] });

describe('what the drawer never has (§10.1)', () => {
  it('no Download my data control, no export button or link', () => {
    const { container } = renderDrawer();
    expect(screen.queryByTestId('download-my-data')).toBeNull();
    expect(container.querySelector('a[href*="export"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /download|export/i })).toBeNull();
    // The warning names the place instead.
    expect(container.textContent).toContain('Settings → Download my data');
  });

  it('no mailto outside the blocker, not-available and failure lines', () => {
    const { container } = renderDrawer();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});

describe('the warning in English and Hebrew', () => {
  it('English, left to right', () => {
    renderDrawer();
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(en['settings.account_delete.warning'])).toBeInTheDocument();
  });

  it('Hebrew, right to left, the Hebrew statement shown and its box RTL', () => {
    renderDrawer({}, 'he');
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(he['settings.account_delete.warning'])).toBeInTheDocument();
    expect(screen.getByTestId('delete-account-statement')).toHaveTextContent(DELETION_STATEMENTS.he);
    expect(screen.getByLabelText(he['settings.account_delete.statement_label'])).toHaveAttribute('dir', 'rtl');
  });

  it('the billing-kept line only when the check says so', () => {
    renderDrawer();
    expect(screen.queryByText(en['settings.account_delete.billing_kept'])).toBeNull();
  });

  it('the billing-kept line wording does not claim real money was paid (DE-10b.1 QA I-a)', () => {
    renderDrawer({ willKeepBilling: true });
    const text = screen.getByText(en['settings.account_delete.billing_kept']).textContent ?? '';
    expect(text).not.toMatch(/real money|you paid/i);
  });
});

describe('the statement box', () => {
  it('has a label; the button stays disabled until the statement matches', () => {
    renderDrawer();
    expect(box()).toBeInTheDocument();
    expect(button()).toBeDisabled();
    fireEvent.change(box(), { target: { value: 'I have downloaded my data' } });
    expect(button()).toBeDisabled();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en.toUpperCase() } });
    expect(button()).toBeEnabled();
  });

  it('a pasted match enables it (no paste block)', () => {
    renderDrawer();
    const pasted = fireEvent.paste(box(), { clipboardData: { getData: () => DELETION_STATEMENTS.en } });
    expect(pasted).toBe(true); // not prevented
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    expect(button()).toBeEnabled();
  });

  it('the English statement enables the button in the Hebrew UI', () => {
    renderDrawer({}, 'he');
    fireEvent.change(screen.getByLabelText(he['settings.account_delete.statement_label']), { target: { value: DELETION_STATEMENTS.en } });
    expect(screen.getByRole('button', { name: he['settings.account_delete.delete_button'] })).toBeEnabled();
  });
});

describe('blockers and availability', () => {
  it('blockers → listed in plain words with the support mailto, and no statement box', () => {
    renderDrawer({ blockers: [{ code: 'plan_running' }, { code: 'client_plans_running', count: 2 }, { code: 'contact_support' }] });
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
    expect(screen.queryByRole('button', { name: en['settings.account_delete.delete_button'] })).toBeNull();
    const list = screen.getByTestId('delete-account-blockers');
    // P-7a.3 (PF-14, C-10): the running plan points at Settings → Plan, not at us.
    expect(list).toHaveTextContent('Your plan is still running. Cancel it in Settings → Plan.');
    expect(list).toHaveTextContent('We need to finish something on our side first. Contact us at');
    expect(list).toHaveTextContent('2 client payment plans are still running');
    expect(list.querySelector(`a[href="mailto:${PLACEHOLDER_ERASURE_CONTACT}"]`)).not.toBeNull();
  });

  it('available: false → the not-available line with the support address, no box', () => {
    const { container } = renderDrawer({ available: false });
    expect(container.textContent).toContain('Deleting your account is not available right now');
    expect(container.querySelector(`a[href="mailto:${PLACEHOLDER_ERASURE_CONTACT}"]`)).not.toBeNull();
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
  });
});

describe('submitting', () => {
  it('Enter in the box submits; success signs out locally, then replaces to the server redirect (V-4)', async () => {
    respond(200, { success: true, data: { redirect: '/account-deleted?lang=en' } });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Enter' });
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/account-deleted?lang=en'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/business-os/account/delete');
    expect(JSON.parse(init.body)).toEqual({ statement: DELETION_STATEMENTS.en, language: 'en' });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local', method: 'account_deleted' });
    expect(mockSignOut.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it('a redirect that is not the account-deleted page is not followed', async () => {
    respond(200, { success: true, data: { redirect: 'https://evil.example/' } });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/account-deleted'));
  });

  it('no double submit while deleting', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    const busy = screen.getByRole('button', { name: en['settings.account_delete.deleting'] });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: false, status: 500, json: async () => ({ error: 'delete_failed', filesRemoved: false }) });
    });
  });

  it('a server mismatch renders in role="alert"', async () => {
    respond(400, { success: false, error: 'statement_mismatch' });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(en['settings.account_delete.mismatch']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a 409 re-renders the server blockers, and the files-removed line when files went (C2-11)', async () => {
    respond(409, { success: false, error: 'blocked', blockers: [{ code: 'stripe_connected' }], filesRemoved: true });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    expect(await screen.findByTestId('delete-account-blockers')).toHaveTextContent('Your Stripe account is still connected');
    expect(screen.getByRole('alert')).toHaveTextContent('Your files were removed but your account was kept');
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
  });

  it('429 and failures render their lines', async () => {
    respond(429, { success: false });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(en['settings.account_delete.too_many']);
    fetchMock.mockRejectedValue(new Error('offline'));
    await act(async () => {
      fireEvent.click(button());
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account was not deleted');
  });

  it('the button is reachable by keyboard (a real button in the tab order)', () => {
    renderDrawer();
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
    respond(409, { success: false, error: 'blocked', blockers: [], filesRemoved: false });
    renderDrawer();
    fireEvent.change(box(), { target: { value: DELETION_STATEMENTS.en } });
    await act(async () => {
      fireEvent.click(button());
    });
    expect(await screen.findByTestId('delete-account-blockers')).toHaveTextContent('We need to finish something on our side first');
    expect(screen.queryByLabelText(en['settings.account_delete.statement_label'])).toBeNull();
  });

  it('N-3: a counted blocker without a count renders its uncounted copy, never an empty number', () => {
    expect(blockerCopyKey({ code: 'client_plans_running' })).toBe('settings.account_delete.blocker.client_plans_running_uncounted');
    expect(blockerCopyKey({ code: 'client_plans_running', count: 3 })).toBe('settings.account_delete.blocker.client_plans_running');
    expect(blockerCopyKey({ code: 'plan_running' })).toBe('settings.account_delete.blocker.plan_running');
    renderDrawer({ blockers: [{ code: 'client_plans_running' }, { code: 'client_payments_pending' }] });
    const list = screen.getByTestId('delete-account-blockers');
    expect(list).toHaveTextContent(en['settings.account_delete.blocker.client_plans_running_uncounted']);
    expect(list).toHaveTextContent(en['settings.account_delete.blocker.client_payments_pending_uncounted']);
    expect(list.textContent).not.toMatch(/\{n\}|^\s|  client/);
  });

  it('N-3: the uncounted keys exist in all three dictionaries', () => {
    for (const dictionary of [en, he] as unknown as Array<Record<string, string>>) {
      expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).toBeTruthy();
      expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).not.toContain('{n}');
    }
  });
});
