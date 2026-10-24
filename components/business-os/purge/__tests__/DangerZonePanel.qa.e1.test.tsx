/**
 * @jest-environment jsdom
 *
 * QA re-test of E-1 (2026-10-21), the cases the Dev host tests leave out:
 *   - the settings dialog checks once PER OPEN (close + reopen = a second check);
 *   - while the check is still loading, both hosts show exactly today's text;
 *   - in Hebrew (through the language context), the ready state reads
 *     "מחיקת החשבון שלי" and the warning shows exactly once, in the dialog and
 *     in the boxed panel; off reads today's Hebrew text.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data">Download my data</button>,
}));
jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: jest.fn() }));

let mockLanguage: { t: (key: string, vars?: Record<string, string | number>) => string; isRTL: boolean; language: string } | null = null;
jest.mock('@/lib/business-os/LanguageContext', () => ({ useOptionalLanguage: () => mockLanguage }));

import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { DangerZonePanel, ErasureDialogBody } from '@/components/business-os/purge/DangerZonePanel';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';

jest.setTimeout(30000);

const CHECK_URL = '/api/business-os/account/deletion-check';
const READY = { enabled: true, available: true, blockers: [], willKeepBilling: false, exportFacts: { lastReadyAt: null, downloaded: false } };
const fetchMock = jest.fn();
const checkCalls = () => fetchMock.mock.calls.filter(([url]) => url === CHECK_URL).length;

function dictionaryLanguage(dictionary: Record<string, string>, language: string, isRTL: boolean) {
  return {
    t: (key: string, vars?: Record<string, string | number>) => {
      let text = dictionary[key] ?? key;
      for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
      return text;
    },
    isRTL,
    language,
  };
}

const answer = (data: unknown) => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data }) });

beforeEach(() => {
  fetchMock.mockReset();
  mockLanguage = null;
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger>Open delete</DialogTrigger>
      <DialogContent>
        <ErasureDialogBody />
      </DialogContent>
    </Dialog>
  );
}

const count = (root: HTMLElement, text: string) => within(root).queryAllByText(text).length;

describe('one check per open (settings dialog)', () => {
  it('open → 1 check, close → still 1, reopen → 2', async () => {
    answer(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    await screen.findByTestId('delete-account-drawer');
    expect(checkCalls()).toBe(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(checkCalls()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    await screen.findByTestId('delete-account-drawer');
    expect(checkCalls()).toBe(2);
  });
});

describe('while the check is loading → today\'s text', () => {
  it('settings dialog', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(en['settings.security.erasure_request_title'])).toBeInTheDocument();
    expect(count(dialog, en['settings.security.delete_warning'])).toBe(1);
    expect(within(dialog).getByTestId('download-my-data')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-account-drawer')).toBeNull();
  });

  it('boxed panel', async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup({ delay: null });
    const { container } = render(<DangerZonePanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const region = await screen.findByRole('region', { name: en['settings.security.erasure_request_title'] });
    expect(count(container, en['settings.security.delete_warning'])).toBe(1);
    expect(within(region).getByTestId('download-my-data')).toBeInTheDocument();
  });
});

describe('Hebrew', () => {
  const HE = he as unknown as Record<string, string>;
  const heWarningOnce = (root: HTMLElement) =>
    count(root, HE['settings.security.delete_warning']) + count(root, HE['settings.account_delete.warning']);

  it('settings dialog ready → "מחיקת החשבון שלי", one warning (the drawer\'s), RTL drawer', async () => {
    mockLanguage = dictionaryLanguage(HE, 'he', true);
    answer(READY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    const drawer = await within(dialog).findByTestId('delete-account-drawer');
    expect(drawer).toHaveAttribute('dir', 'rtl');
    expect(dialog).toHaveAccessibleDescription('מחיקת החשבון שלי');
    expect(count(dialog, HE['settings.security.erasure_request_title'])).toBe(0);
    expect(count(dialog, HE['settings.security.delete_warning'])).toBe(0);
    expect(heWarningOnce(dialog)).toBe(1);
  });

  it('settings dialog off → today\'s Hebrew description and host warning', async () => {
    mockLanguage = dictionaryLanguage(HE, 'he', true);
    answer({ enabled: false });
    const user = userEvent.setup({ delay: null });
    render(<SettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Open delete' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(checkCalls()).toBe(1));
    expect(dialog).toHaveAccessibleDescription(HE['settings.security.erasure_request_title']);
    expect(count(dialog, HE['settings.security.delete_warning'])).toBe(1);
    expect(heWarningOnce(dialog)).toBe(1);
  });

  it('boxed panel ready → Hebrew heading, one warning; closing brings today\'s host warning back', async () => {
    mockLanguage = dictionaryLanguage(HE, 'he', true);
    answer(READY);
    const user = userEvent.setup({ delay: null });
    const { container } = render(<DangerZonePanel />);
    const toggle = screen.getByRole('button', { name: HE['settings.security.delete_button'] });
    await user.click(toggle);
    const region = await screen.findByRole('region', { name: 'מחיקת החשבון שלי' });
    await within(region).findByTestId('delete-account-drawer');
    expect(heWarningOnce(container)).toBe(1);
    expect(count(container, HE['settings.security.delete_warning'])).toBe(0);
    await user.click(toggle);
    expect(screen.queryByRole('region')).toBeNull();
    expect(count(container, HE['settings.security.delete_warning'])).toBe(1);
  });
});
