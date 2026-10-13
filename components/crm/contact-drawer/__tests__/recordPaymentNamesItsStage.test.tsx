/**
 * @jest-environment jsdom
 *
 * When two stages are both invoiced, the owner says which one they are recording.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A ₪800 quote, both stages billed and both sitting with the client at ₪400
 * each, opened a dialog whose only action read "Record payment · ₪400". It
 * meant the deposit, silently, because the code settled `outstandingStage` —
 * the FIRST unpaid period — and offered no way to reach the other.
 *
 * Two failures in one. The owner could not tell which payment the button
 * referred to, and a client who paid the final milestone in cash first could
 * not have it recorded at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE RENDER INSTEAD OF READING THE SOURCE
 *
 * What matters is which INVOICE the request goes to after a click, and that is
 * the product of selection state, a filter and a fallback chain. A source
 * assertion would pin the shape of today's implementation; this pins the
 * behaviour, so the next refactor is free as long as the right invoice is
 * settled.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * The dialog mounts `CancelPlanModal` unconditionally (closed), and that
 * component calls `useLanguage`, which throws outside a provider. Mocked rather
 * than wrapped: the real provider fetches business settings on mount, which
 * would make these tests depend on network stubs for a question about which
 * invoice a button settles.
 */
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', isRTL: false }),
  useBusinessTimezone: () => ({
    timezone: 'UTC',
    timeZoneOptions: (options: Record<string, unknown> = {}) => ({ ...options, timeZone: 'UTC' }),
  }),
}));

import { PaymentManagementModal } from '../PaymentManagementModal';
import type { SessionCardData } from '../types';

const COPY: Record<string, string> = {
  'crm.payment.manage': 'Manage payment',
  'crm.payment.record_payment': 'Record payment',
  'crm.payment.recording_for': 'Recording a payment for',
  'payments.payment_method': 'Payment method',
  'payments.payment_method.cash': 'Cash',
  'payments.payment_method.bank_transfer': 'Bank transfer',
  'payments.payment_method.check': 'Cheque',
  'payments.payment_method.card': 'Card',
  'payments.payment_method.other': 'Other',
  'crm.payment.status_invoiced': 'Invoiced',
  'button.close': 'Close',
};

const t = (key: string) => COPY[key] ?? key;

/** The job from the report: two stages, both billed, neither paid. */
const stage = (id: string, label: string, invoiceId: string) => ({
  id,
  label,
  amount: 400,
  status: 'pending',
  trigger: 'manual' as const,
  invoiceId,
  dueDate: null,
  paidAt: null,
});

const booking = {
  booking: {
    id: 'booking-1',
    status: 'confirmed',
    service: { service_name: 'Renovation quote' },
  },
  payment: {
    amount: 800,
    currency: 'ILS',
    status: 'pending',
    plan: {
      installmentCount: 2,
      installmentAmount: 400,
      totalAmount: 800,
      frequency: 'milestone',
      periodsPaid: 0,
      stages: [
        stage('s1', 'Deposit', 'invoice-deposit'),
        stage('s2', 'On completion', 'invoice-final'),
      ],
    },
  },
} as unknown as SessionCardData;

let fetched: { url: string; body: unknown }[] = [];

beforeEach(() => {
  fetched = [];
  global.fetch = (async (url: string, init?: { body?: string }) => {
    fetched.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return {
      ok: true,
      json: async () => ({ success: true, data: { transactionId: 'tx-1' } }),
    };
  }) as unknown as typeof fetch;
});

function open() {
  render(
    <PaymentManagementModal
      isOpen
      onClose={() => {}}
      booking={booking}
      contactName="Shlomo"
      onPaymentUpdated={() => {}}
      t={t}
    />
  );
}

describe('the action names the stage it settles', () => {
  it('says which payment is being recorded', () => {
    open();

    /*
       Not "Record payment · ₪400" alone, which describes both stages equally.

       Scoped to the action panel on purpose: the stage name appears twice by
       design — once on its card and once here — and a bare `getByText` finds
       both, which would make this fail for the very reason it should pass.
    */
    const line = screen.getByText('Recording a payment for').closest('p');

    expect(line).toHaveTextContent('Deposit');
    expect(line).not.toHaveTextContent('On completion');
  });

  it('defaults to the earliest collectable stage', async () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));

    await waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0].url).toContain('invoice-deposit');
  });
});

describe('the other invoiced stage is reachable', () => {
  it('settles the stage the owner picks, not the first one', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * A client who pays the final milestone in cash before the deposit had
     * no route into the product at all: the dialog settled the deposit's
     * invoice or nothing.
     * ─────────────────────────────────────────────────────────────────────
     */
    open();

    const choices = screen.getAllByRole('radio', { name: /Deposit|On completion/ });
    expect(choices).toHaveLength(2);

    fireEvent.click(screen.getByRole('radio', { name: /On completion/ }));

    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));

    await waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0].url).toContain('invoice-final');
    expect(fetched[0].url).not.toContain('invoice-deposit');
  });
});

describe('the payment method', () => {
  it('offers every method as a chip rather than hiding four in a menu', () => {
    open();

    for (const label of ['Bank transfer', 'Cash', 'Cheque', 'Card', 'Other']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    // And no native select, which is what those chips replaced.
    expect(document.querySelector('select')).toBeNull();
  });

  it('sends the one the owner picked', async () => {
    // The whole point of the control: cash recorded as a bank transfer is a
    // figure in the books that never happened.
    open();

    fireEvent.click(screen.getByRole('radio', { name: 'Cash' }));
    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));

    await waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0].body).toMatchObject({ payment_method: 'cash' });
  });

  it('defaults to bank transfer, so the one-click path is unchanged', async () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: /Record payment/ }));

    await waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0].body).toMatchObject({ payment_method: 'bank_transfer' });
  });
});
