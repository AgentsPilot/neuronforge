/**
 * @jest-environment jsdom
 *
 * QA pre-merge pass for DE-10b.2 (workplan § SA Code Review — 2026-10-21,
 * "What QA must exercise"), extended for DL-2a (DL-2 workplan §8, §12 row 4,
 * T-6). Gaps the Dev suites did not cover:
 *
 *   - a keyboard-only pass with user-event INSIDE the real Radix dialog that
 *     hosts `ErasureRequestContent` on /business-os/settings (V-8): Tab reaches
 *     the export control, the reason group, the box; Space picks a reason;
 *     typing + Enter submits; there is one dialog only; Escape closes it and
 *     focus returns to the trigger. DL-2a: after a recorded request focus lands
 *     on the pending view, and Keep my account is reachable by keyboard;
 *   - the boxed `DangerZonePanel` (the /v2/settings and /settings surface):
 *     switch off → today's body inside the region, switch on → the steps there;
 *   - the Hebrew statement typed with niqqud (and bidi marks) enables the button;
 *   - the dictionaries carry every `settings.account_delete.*` and
 *     `account_closure.*` key in en / he / es, with their placeholders.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));

// SA CR-1: the hosts refresh through `useRouter()` from next/navigation.
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }) }));

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { DangerZonePanel, ErasureDialogBody } from '@/components/business-os/purge/DangerZonePanel';
import { DeleteAccountDrawer, type CopyFn } from '../DeleteAccountDrawer';
import { DELETION_STATEMENTS } from '@/lib/business-os/account-deletion/acknowledgement';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const READY = { enabled: true as const, available: true as const, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };
const CLOSURE_URL = '/api/business-os/account/closure';
const CHECK_URL = '/api/business-os/account/deletion-check';
const KEEP_URL = '/api/business-os/account/keep';
const PENDING = {
  status: 'pending',
  planEndsAt: '2026-11-26T10:00:00.000Z',
  lockAt: '2026-12-09T22:00:00.000Z',
  lockAtIsProjected: true,
  timezone: 'Asia/Jerusalem',
  renewalWasOn: true,
  graceDays: 14,
};

jest.setTimeout(30000);

const fetchMock = jest.fn();
let deleteAnswer: { status: number; body: unknown } = { status: 400, body: { success: false, error: 'statement_mismatch' } };
let closureAnswers: unknown[] = [null];

function routeFetch(checkData: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === CHECK_URL) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: checkData }) };
    }
    if (url === CLOSURE_URL) {
      const closure = closureAnswers.length > 1 ? closureAnswers.shift() : closureAnswers[0];
      return { ok: true, status: 200, json: async () => ({ success: true, data: { closure } }) };
    }
    if (url === KEEP_URL) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { kept: true, from: 'pending', renewal: 'restored' } }) };
    }
    return { ok: deleteAnswer.status === 200, status: deleteAnswer.status, json: async () => deleteAnswer.body };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  deleteAnswer = { status: 400, body: { success: false, error: 'statement_mismatch' } };
  closureAnswers = [null];
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

/** The /business-os/settings shape: one Radix dialog, the shared body inside it, a Close button after it. */
function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger>Delete account</DialogTrigger>
      <DialogContent>
        {/* QA E-1 (Dev): the host body owns the title, the description and the one read per open. */}
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
}

const deleteCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/business-os/account/delete');
const callsTo = (target: string) => fetchMock.mock.calls.filter(([url]) => url === target);

async function tabTo(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let i = 0; i < 25 && document.activeElement !== element; i += 1) await user.tab();
  expect(document.activeElement).toBe(element);
}

describe('keyboard-only pass inside the one settings dialog (V-8)', () => {
  it('Tab reaches export, the reasons, the box; Space picks; Enter submits; one dialog only; Escape closes and focus returns', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);

    const trigger = screen.getByRole('button', { name: 'Delete account' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-account-drawer');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await tabTo(user, within(dialog).getByTestId('download-my-data'));
    const firstReason = within(dialog).getByTestId('delete-account-reason-too_expensive');
    await tabTo(user, firstReason);
    await user.keyboard(' ');
    expect(firstReason).toBeChecked();

    const box = within(dialog).getByLabelText('Type the statement to confirm');
    await tabTo(user, box);
    const button = within(dialog).getByRole('button', { name: 'Delete my account forever' });
    expect(button).toBeDisabled();
    await user.keyboard(DELETION_STATEMENTS.en);
    expect(button).toBeEnabled();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ statement: DELETION_STATEMENTS.en, language: 'en', reasonCode: 'too_expensive' });
    // The refusal renders in an alert inside the same dialog; still one dialog.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The statement does not match');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Tab moves on to the request button (reachable), Escape closes the dialog.
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('the reasons are one radio group: arrow keys move the choice', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    const first = await within(dialog).findByTestId('delete-account-reason-too_expensive');
    await user.click(first);
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByTestId('delete-account-reason-not_using_enough')).toBeChecked();
    expect(first).not.toBeChecked();
  });

  it('Enter in the box does nothing while the statement does not match', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('delete-account-reason-other'));
    const box = within(dialog).getByLabelText('Type the statement to confirm');
    await user.click(box);
    await user.keyboard('I want my account deleted{Enter}');
    expect(deleteCalls()).toHaveLength(0);
  });

  it('a recorded request → focus on the pending view; Keep is reached by Tab and pressed with Enter; the kept line takes focus', async () => {
    deleteAnswer = { status: 200, body: { success: true, data: { status: 'pending', planEndsOn: PENDING.planEndsAt, renewalWasOn: true } } };
    closureAnswers = [null, PENDING, null];
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByTestId('delete-account-reason-switching_tool'));
    await user.click(within(dialog).getByLabelText('Type the statement to confirm'));
    await user.keyboard(DELETION_STATEMENTS.en);
    await user.keyboard('{Enter}');
    const body = await within(dialog).findByTestId('closure-pending-body');
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(dialog).toHaveAccessibleDescription('Your account is set to close');

    const keep = within(dialog).getByRole('button', { name: 'Keep my account' });
    await tabTo(user, keep);
    await user.keyboard('{Enter}');
    const notice = await within(dialog).findByTestId('closure-notice');
    await waitFor(() => expect(document.activeElement).toBe(notice));
    expect(notice).toHaveTextContent('Your account is kept, and your plan will renew as before.');
    expect(callsTo(KEEP_URL)).toHaveLength(1);
  });

  it('switch off: the same dialog shows today\'s body (export + Contact us), no box', async () => {
    routeFetch({ enabled: false });
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(1));
    expect(within(dialog).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
  });
});

describe('the boxed DangerZonePanel (/v2/settings, /settings)', () => {
  it('switch off → today\'s body inside the region, and nothing is read until the panel opens', async () => {
    routeFetch({ enabled: false });
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(1));
    expect(callsTo(CLOSURE_URL)).toHaveLength(1);
    expect(within(region).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Contact us' })).toBeInTheDocument();
    expect(within(region).queryByTestId('delete-account-drawer')).toBeNull();
  });

  it('switch on → the steps inside the region, one export control (S-4), no second dialog', async () => {
    routeFetch(READY);
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    expect(await within(region).findByTestId('delete-account-drawer')).toBeInTheDocument();
    expect(within(region).getAllByTestId('download-my-data')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switch on but not available (no cleanup secret) → the not-available line with the support address', async () => {
    routeFetch({ ...READY, available: false });
    const user = userEvent.setup({ delay: null });
    render(<DangerZonePanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region');
    const status = await within(region).findByRole('status');
    expect(status).toHaveTextContent('Deleting your account is not available right now');
    expect(status.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(within(region).queryByLabelText('Type the statement to confirm')).toBeNull();
  });
});

describe('Hebrew pass', () => {
  const tr = (dictionary: Record<string, string>): CopyFn => (key, vars) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

  it('the Hebrew statement typed with niqqud and bidi marks enables the button; Enter sends the typed text as is', async () => {
    deleteAnswer = { status: 200, body: { success: true, data: { status: 'grace', lockAt: '2026-12-01T22:00:00.000Z', lockTimezone: 'Asia/Jerusalem' } } };
    routeFetch(READY);
    const onRequestAnswered = jest.fn().mockResolvedValue('open');
    const user = userEvent.setup({ delay: null });
    const dictionary = he as unknown as Record<string, string>;
    render(<DeleteAccountDrawer check={READY} tr={tr(dictionary)} language="he" isRTL onRequestAnswered={onRequestAnswered} />);
    await user.click(screen.getByLabelText(dictionary['settings.plan_cancel.reason.technical_problems']));
    const box = screen.getByLabelText(dictionary['settings.account_delete.statement_label']);
    expect(box).toHaveAttribute('dir', 'rtl');
    const typed = `‏${DELETION_STATEMENTS.he.replace('הורדתי', 'הוֹרַדְתִּי')}`;
    await user.click(box);
    await user.keyboard(typed);
    const button = screen.getByRole('button', { name: dictionary['settings.account_delete.request_button'] });
    expect(button).toBeEnabled();
    await act(async () => {
      await user.keyboard('{Enter}');
    });
    await waitFor(() => expect(onRequestAnswered).toHaveBeenCalledWith({ kind: 'recorded' }));
    expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ statement: typed, language: 'he', reasonCode: 'technical_problems' });
  });
});

describe('dictionaries (T-6)', () => {
  const keys = (dictionary: unknown, prefix: string) =>
    Object.keys(dictionary as Record<string, string>)
      .filter((key) => key.startsWith(prefix))
      .sort();

  it('Spanish has the N-3 uncounted keys, with no {n}', () => {
    const dictionary = es as unknown as Record<string, string>;
    expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).toBeTruthy();
    expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).toBeTruthy();
    expect(dictionary['settings.account_delete.blocker.client_plans_running_uncounted']).not.toContain('{n}');
    expect(dictionary['settings.account_delete.blocker.client_payments_pending_uncounted']).not.toContain('{n}');
  });

  it.each(['settings.account_delete.', 'account_closure.'])('en, he and es hold the same %s* key set, and every placeholder is kept', (prefix) => {
    expect(keys(en, prefix).length).toBeGreaterThan(5);
    expect(keys(he, prefix)).toEqual(keys(en, prefix));
    expect(keys(es, prefix)).toEqual(keys(en, prefix));
    for (const dictionary of [en, he, es] as unknown as Array<Record<string, string>>) {
      for (const key of keys(en, prefix)) {
        const english = (en as unknown as Record<string, string>)[key];
        for (const slot of english.match(/\{\w+\}/g) ?? []) expect(dictionary[key]).toContain(slot);
      }
    }
  });

  it('the PLAN PAYMENTS lines (claims) exist in all three, naming Keep my account in each language (Q-1)', () => {
    const button = { en: 'Keep my account', he: 'להשאיר את החשבון', es: 'Mantener mi cuenta' };
    for (const [lang, dictionary] of Object.entries({ en, he, es }) as Array<['en' | 'he' | 'es', unknown]>) {
      const d = dictionary as Record<string, string>;
      expect(d['account_closure.keep_button']).toBe(button[lang]);
      for (const key of ['plan.manage.refusal.deletion_pending', 'plan.refusal.deletion_pending', 'usage.boost.error.deletion_pending']) {
        expect(d[key]).toContain(button[lang]);
      }
    }
  });

  it('Q-11: the five keys nothing reads any more are gone from all three', () => {
    for (const dictionary of [en, he, es] as unknown as Array<Record<string, string>>) {
      for (const key of ['what_next', 'delete_button', 'deleting', 'delete_failed', 'files_removed_kept']) {
        expect(dictionary[`settings.account_delete.${key}`]).toBeUndefined();
      }
    }
  });
});
