/**
 * @jest-environment jsdom
 *
 * The Credits card's Top up button (credits boost slice 5a; user decision B,
 * 2026-10-07; SA Q-6). Every owner sees it once the first read settles,
 * including on the error line; it is hidden only while that first read runs.
 * The card's own mount makes no packages request; opening does.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string, vars?: Record<string, string | number>) => {
        let text: string = translations.en[key] || key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
        return text;
      },
      timeZoneOptions: (options: Intl.DateTimeFormatOptions = {}) => ({ ...options, timeZone: 'UTC' }),
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { UsageCard } from '@/components/business-os/UsageCard';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';

const USAGE: OwnerCreditUsage = {
  period: { kind: 'monthly', resetsOn: '2026-10-14T09:31:07.123Z' },
  allowance: { amount: 32250, per: 'month' },
  used: 100,
  usedByOwner: 100,
  usedAutomatic: 0,
  extraCredits: 0,
  remaining: 32150,
} as OwnerCreditUsage;

type Handler = (url: string) => { ok: boolean; status: number; body: unknown } | Promise<never>;
let fetchMock: jest.Mock;
function installFetch(handler: Handler) {
  fetchMock = jest.fn(async (url: string) => {
    const reply = await handler(String(url));
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

async function packagesReply() {
  const packages = (await codeBoostPackageSource().listActive()).map(toBoostPackageView);
  return { ok: true, status: 200, body: { success: true, data: { packages, purchaseAvailable: false } } };
}

describe('Top up on the Credits card', () => {
  it('hidden while the first read runs, then shown; the mount makes no packages request', async () => {
    let release: (value: { ok: boolean; status: number; body: unknown }) => void = () => {};
    installFetch(() => new Promise((resolve) => (release = resolve)) as never);
    render(<UsageCard />);
    expect(screen.queryByTestId('credits-top-up')).not.toBeInTheDocument();

    release({ ok: true, status: 200, body: { success: true, data: USAGE } });
    await waitFor(() => expect(screen.getByTestId('credits-top-up')).toBeInTheDocument());
    expect(screen.getByTestId('credits-top-up')).toHaveTextContent('Top up');
    expect(urls().some((url) => url.includes('/boost/'))).toBe(false);
    expect(screen.queryByTestId('boost-packages-panel')).not.toBeInTheDocument();
  });

  it('shown on the error line too (SA Q-6)', async () => {
    installFetch(() => ({ ok: false, status: 500, body: { success: false } }));
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-error')).toBeInTheDocument());
    expect(screen.getByTestId('credits-top-up')).toBeInTheDocument();
  });

  it('opens the picker, which reads the packages (and never the checkout)', async () => {
    const packages = await packagesReply();
    installFetch((url) => (url.includes('/boost/packages') ? packages : { ok: true, status: 200, body: { success: true, data: USAGE } }));
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-top-up')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('credits-top-up'));
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    expect(screen.getByTestId('boost-packages-panel')).toBeInTheDocument();
    expect(urls().filter((url) => url.includes('/boost/packages'))).toHaveLength(1);
    expect(urls().some((url) => url.includes('/checkout'))).toBe(false);
  });

  it('the ring, the percentage and the extra figure are unchanged by the button', async () => {
    installFetch(() => ({ ok: true, status: 200, body: { success: true, data: { ...USAGE, extraCredits: 0 } } }));
    render(<UsageCard />);
    await waitFor(() => expect(screen.getByTestId('credits-top-up')).toBeInTheDocument());
    expect(screen.getByTestId('credits-headline')).not.toHaveTextContent('—');
    expect(screen.queryByTestId('credits-extra')).not.toBeInTheDocument();
  });
});

describe('R-1 (QA5a-D1): focus returns to Top up when the picker closes', () => {
  async function openPicker() {
    const packages = await packagesReply();
    installFetch((url) => (url.includes('/boost/packages') ? packages : { ok: true, status: 200, body: { success: true, data: USAGE } }));
    render(<UsageCard />);
    const button = await screen.findByTestId('credits-top-up');
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByTestId('boost-package')).toHaveLength(3));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    return button;
  }

  it('after Escape', async () => {
    const button = await openPicker();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });

  it('after the close button', async () => {
    const button = await openPicker();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });

  it('and again after a second open', async () => {
    const button = await openPicker();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(button);
  });
});
