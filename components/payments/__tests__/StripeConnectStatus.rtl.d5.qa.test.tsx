/**
 * @jest-environment jsdom
 *
 * QA (D5 / SX-5, 2026-10-30): the Remove connection refusal, rendered in
 * Hebrew. The refusal line appears inline in the confirm dialog (no `alert`),
 * inside a right-to-left dialog, with the support address filled in, and the
 * Hebrew button label. Also: the Standard confirm text for a Standard account,
 * F-1 in Hebrew, and a network failure.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { he: dict } = jest.requireActual('@/lib/business-os/translations/he') as { he: Record<string, string> };
  return { useLanguage: () => ({ language: 'he', isRTL: true, t: (key: string) => dict[key] || key }) };
});

import { he } from '@/lib/business-os/translations/he';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { StripeConnectStatus } from '@/components/payments/StripeConnectStatus';

const HE = he as unknown as Record<string, string>;
const ACCOUNT = {
  id: 'row-1',
  stripe_account_id: 'acct_1QaRtl',
  stripe_account_type: 'standard',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  onboarding_completed: true,
  country: 'IL',
  currency: 'ils',
};

const mockFetch = jest.fn();
const mockAlert = jest.fn();

function respond(deleteAnswer: (() => Promise<unknown>) | { status: number; body: unknown }) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      if (typeof deleteAnswer === 'function') return deleteAnswer();
      return Promise.resolve({ ok: deleteAnswer.status < 400, status: deleteAnswer.status, json: () => Promise.resolve(deleteAnswer.body) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: ACCOUNT }) });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
  window.alert = mockAlert;
});

async function openConfirmAndRemove() {
  render(<StripeConnectStatus detailed />);
  const openButton = await screen.findByRole('button', { name: HE['config.stripe.remove_connection'] });
  await act(async () => {
    fireEvent.click(openButton);
  });
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: HE['config.stripe.remove_connection'] });
  await act(async () => {
    fireEvent.click(confirm);
  });
  return dialog;
}

describe('QA D5: StripeConnectStatus Remove refusal in Hebrew (RTL)', () => {
  it('not_available: the Hebrew line with the support address, inline, inside an RTL dialog; no alert()', async () => {
    respond({ status: 409, body: { success: false, error: 'not_available' } });
    const dialog = await openConfirmAndRemove();

    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent(HE['config.stripe.refused.not_available'].replace('{support}', PLACEHOLDER_ERASURE_CONTACT));
    expect(refusal.textContent).not.toContain('{support}');
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(mockAlert).not.toHaveBeenCalled();
    // The dialog stays open, the account is still listed.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the confirm dialog shows the Hebrew title and the Standard text for a Standard account', async () => {
    respond({ status: 409, body: { success: false, error: 'check_failed' } });
    const dialog = await openConfirmAndRemove();
    expect(dialog).toHaveTextContent(HE['config.stripe.remove_title']);
    expect(dialog).toHaveTextContent(HE['config.stripe.remove_message_standard']);
    expect(dialog).not.toHaveTextContent(HE['config.stripe.remove_message_express']);
  });

  it('client money in flight lists each Hebrew blocker line with its count', async () => {
    respond({ status: 409, body: { success: false, error: 'client_money_in_flight', blockers: [{ code: 'client_plans_running', count: 3 }, { code: 'client_payments_pending' }] } });
    const dialog = await openConfirmAndRemove();
    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent(HE['config.stripe.refused.client_plans_running'].replace('{n}', '3'));
    expect(refusal).toHaveTextContent(HE['config.stripe.refused.client_payments_pending_uncounted']);
  });

  it('F-1 in Hebrew: record_not_removed never says nothing changed', async () => {
    respond({ status: 500, body: { success: false, error: 'record_not_removed' } });
    const dialog = await openConfirmAndRemove();
    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent(PLACEHOLDER_ERASURE_CONTACT);
    expect(refusal).not.toHaveTextContent('לא שינינו דבר');
  });

  it('a network failure shows the generic Hebrew line inline, never an alert', async () => {
    respond(() => Promise.reject(new TypeError('Failed to fetch')));
    const dialog = await openConfirmAndRemove();
    const refusal = await within(dialog).findByRole('alert');
    expect(refusal).toHaveTextContent(HE['config.stripe.refused.generic']);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('the red confirm button carries the F-3 classes', async () => {
    respond({ status: 409, body: { success: false, error: 'check_failed' } });
    const dialog = await openConfirmAndRemove();
    const confirm = within(dialog).getByRole('button', { name: HE['config.stripe.remove_connection'] });
    expect(confirm.className).toContain('!bg-red-500');
    expect(confirm.className).toContain('!text-white');
  });
});
