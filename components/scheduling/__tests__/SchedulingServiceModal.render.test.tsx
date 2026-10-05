/**
 * @jest-environment jsdom
 *
 * What the restructured service editor must still do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The form used to ask three questions drawn identically, one of which hid
 * itself whenever the price was 0 or the service was quoted. It now asks two,
 * and folds the payment question into the selling one — so the risk of the
 * change is not how it looks. It is that pressing a shape must write BOTH
 * stored columns, and that the sentence beneath must describe what will really
 * happen, including the case the owner cannot see: a card service on an account
 * with no processor is invoiced.
 *
 * These render the real modal with its collaborators faked, press the shapes,
 * and read what it says.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

/*
 * The copy for the keys these tests read.
 *
 * A `t` that echoed its key would turn every assertion into a check that the
 * key is spelled right. What is being tested here is which SENTENCE the form
 * chooses, so the real English is what it returns.
 */
const COPY: Record<string, string> = {
  'scheduling.modal.section.service': 'The service',
  'scheduling.modal.section.client_gets': 'What the client gets',
  'scheduling.modal.section.sold_paid': 'How it is sold and paid',
  'scheduling.modal.section.means': 'What this means',
  'scheduling.modal.shape.card': 'They pay by card',
  'scheduling.modal.shape.invoice': 'You invoice them',
  'scheduling.modal.shape.quote': 'You quote first',
  'scheduling.modal.shape.card_desc': 'Charged as they buy. Needs Stripe.',
  'scheduling.modal.shape.invoice_desc': 'Billed after: transfer, Bit or cash.',
  'scheduling.modal.shape.quote_desc': 'They ask; you price the job.',
  'scheduling.modal.quote_note': 'No price here, on purpose: you name the amount in each quote.',
  'scheduling.modal.stripe_missing': 'Cards cannot be charged yet: this service is invoiced instead.',
  'scheduling.modal.needs_time.yes': 'An appointment',
  'scheduling.modal.needs_time.no': 'No appointment',
  'scheduling.modal.rules_na': 'Booking rules do not apply',
  'scheduling.modal.advanced_options': 'Advanced Options',
  'scheduling.modal.price': 'Price',
  'scheduling.modal.length': 'Length',
  'scheduling.modal.length_optional': 'Length (optional)',
  'scheduling.modal.you_get_paid': 'You get paid',
  'scheduling.modal.buffer_time': 'Buffer Time (min)',
  'scheduling.modal.payment_full': 'One Payment',
  'scheduling.modal.payment_installments': 'Payment Plan',
  'scheduling.modal.money.invoice_once': 'You send one invoice for {amount}.',
  'scheduling.modal.money.invoice_once_link': 'You send one invoice for {amount}, with a payment link in it.',
  'scheduling.modal.money.card_once': 'They pay {amount} by card at the moment they buy.',
  'scheduling.modal.money.card_plan': 'They pay {each} by card, then {rest} more {freq} payments of {each}.',
  'scheduling.modal.money.card_no_stripe': 'While Stripe is not connected you invoice {amount} after they buy.',
  'scheduling.modal.money.quote': 'Nothing is charged here.',
  'scheduling.modal.money.free': 'Nothing is collected. This service is free.',
  'scheduling.modal.installment_monthly': 'monthly',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
  }),
}));

// Radix in a portal, with its own pointer-event requirements, would make these
// tests about the dialog rather than about the form.
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

jest.mock('@/components/business-os/setup/ClientJourneyStrip', () => ({
  ClientJourneyStrip: ({ service }: { service: { scheduled: boolean; collection: string | null } }) => (
    <div data-testid="journey" data-scheduled={String(service.scheduled)} data-collection={String(service.collection)} />
  ),
}));

jest.mock('@/components/scheduling/ServiceCurrencySelect', () => ({
  ServiceCurrencySelect: () => <div data-testid="currency" />,
  CURRENCY_OPTIONS: [],
  getCurrencySymbol: () => '₪',
}));

import { SchedulingServiceModal } from '../SchedulingServiceModal';

/** An ordinary invoiced appointment, which is what most accounts start with. */
const SERVICE = {
  id: 'svc-1',
  service_name: 'Individual Therapy Session',
  description: 'A 50-minute session.',
  duration_minutes: 50,
  price: 300,
  currency: 'ILS',
  is_scheduled: true,
  sale_mode: 'direct',
  collection: 'invoice',
  buffer_minutes: 15,
  max_bookings_per_day: null,
  advance_booking_days: 30,
  min_notice_hours: 24,
  is_active: true,
  payment_type: 'full',
  installment_count: 1,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
} as unknown as SchedulingService;

function mountModal(options: { chargesEnabled?: boolean; service?: SchedulingService } = {}) {
  const chargesEnabled = options.chargesEnabled ?? true;

  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/intake/settings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ settings: { is_enabled: false } }),
      } as Response);
    }
    if (url.includes('/api/payments/stripe-connect')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { charges_enabled: chargesEnabled } }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  }) as unknown as typeof fetch;

  return render(
    <SchedulingServiceModal
      service={options.service ?? SERVICE}
      isOpen
      onClose={jest.fn()}
      onServiceUpdated={jest.fn()}
    />
  );
}

/** Lets the intake and processor requests resolve before a press or a read. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(() => {
  jest.clearAllMocks();
});

describe('the four sections', () => {
  it('are all on screen, with no payment question hidden behind Advanced', async () => {
    mountModal();
    await settle();

    expect(screen.getByText('The service')).toBeInTheDocument();
    expect(screen.getByText('What the client gets')).toBeInTheDocument();
    expect(screen.getByText('How it is sold and paid')).toBeInTheDocument();
    expect(screen.getByText('What this means')).toBeInTheDocument();

    // The plan controls are in section 3 now, not folded away.
    expect(screen.getByText('One Payment')).toBeInTheDocument();
    expect(screen.getByText('Payment Plan')).toBeInTheDocument();
  });

  it('opens on the shape the saved service already has', async () => {
    mountModal();
    await settle();

    /*
     * Invoiced, and Stripe is connected in this mount — so the sentence is the
     * one that names the payment link the invoice actually carries, not the
     * transfer-or-cash wording that belongs to an account without a processor.
     */
    expect(screen.getByText(/one invoice for ₪300, with a payment link/)).toBeInTheDocument();
  });
});

describe('pressing a shape', () => {
  it('writes both columns: card sets collection online and keeps it direct', async () => {
    mountModal();
    await settle();

    fireEvent.click(screen.getByText('They pay by card'));

    expect(screen.getByText(/They pay ₪300 by card at the moment they buy/)).toBeInTheDocument();
    // The journey is handed the same pair, so the strip and the sentence cannot
    // describe different services.
    expect(screen.getByTestId('journey')).toHaveAttribute('data-collection', 'online');
  });

  it('a quote removes the price and says why, instead of a dead field', async () => {
    mountModal();
    await settle();

    fireEvent.click(screen.getByText('You quote first'));

    expect(screen.getByText(/No price here, on purpose/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Price')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged here/)).toBeInTheDocument();
    // And the journey is told there is no collection method at all.
    expect(screen.getByTestId('journey')).toHaveAttribute('data-collection', 'null');
  });

  it('a plan on a card service says what is taken and how many follow', async () => {
    mountModal();
    await settle();

    fireEvent.click(screen.getByText('They pay by card'));
    fireEvent.click(screen.getByText('Payment Plan'));

    // Seeded at 2 by the plan button, so ₪150 and one more payment.
    expect(
      screen.getByText(/They pay ₪150 by card, then 1 more monthly payments of ₪150/)
    ).toBeInTheDocument();
  });
});

describe('the processor it cannot see', () => {
  it('says the service is INVOICED when cards cannot be charged', async () => {
    mountModal({ chargesEnabled: false });
    await settle();

    fireEvent.click(screen.getByText('They pay by card'));

    await waitFor(() =>
      expect(screen.getByText(/Cards cannot be charged yet/)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/While Stripe is not connected you invoice ₪300 after they buy/)
    ).toBeInTheDocument();
  });

  it('describes the setting as chosen when the status cannot be read', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;

    render(
      <SchedulingServiceModal service={SERVICE} isOpen onClose={jest.fn()} onServiceUpdated={jest.fn()} />
    );
    await settle();

    fireEvent.click(screen.getByText('They pay by card'));

    // Unknown is not a problem: no notice, and the card sentence stands.
    expect(screen.queryByText(/Cards cannot be charged yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/They pay ₪300 by card at the moment they buy/)).toBeInTheDocument();
  });
});

describe('a service with no appointment', () => {
  it('says the booking rules do not apply, and does not offer them', async () => {
    mountModal();
    await settle();

    fireEvent.click(screen.getByText('No appointment'));

    expect(screen.getByText('Booking rules do not apply')).toBeInTheDocument();
    expect(screen.queryByText('Advanced Options')).not.toBeInTheDocument();
    // Pressing it opens nothing — the fields describe a booking that cannot
    // happen, and their saved values are left untouched.
    expect(screen.queryByText('Buffer Time (min)')).not.toBeInTheDocument();
    expect(screen.getByTestId('journey')).toHaveAttribute('data-scheduled', 'false');
  });

  it('makes the length optional rather than required', async () => {
    mountModal();
    await settle();

    expect(screen.getByLabelText(/Length/)).toBeRequired();

    fireEvent.click(screen.getByText('No appointment'));

    expect(screen.getByLabelText(/Length \(optional\)/)).not.toBeRequired();
  });
});

describe('a free service', () => {
  it('keeps its shape and says nothing is collected', async () => {
    mountModal({ service: { ...SERVICE, price: 0 } as unknown as SchedulingService });
    await settle();

    expect(screen.getByText(/Nothing is collected. This service is free/)).toBeInTheDocument();
    // The shape question is still there — free is a price, not a shape.
    expect(screen.getByText('You invoice them')).toBeInTheDocument();
  });
});
