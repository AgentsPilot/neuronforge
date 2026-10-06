/**
 * @jest-environment jsdom
 *
 * The service editor in the settings dialog — the one owners actually use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It asked three questions, and the third — how the money is collected — was
 * nested inside the price row, so the control that decides whether a business
 * can be paid at all was reached only by typing a number first. It now asks
 * two, the payment question folded into the selling one, and states the whole
 * arrangement in a sentence.
 *
 * What these pin down is not the layout. It is that pressing a shape writes
 * BOTH stored columns, that a quote writes no collection method, and that the
 * sentence tells the truth in the one case an owner cannot see: a card service
 * on an account with no processor is invoiced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

const COPY: Record<string, string> = {
  'scheduling.modal.section.service': 'The service',
  'scheduling.modal.section.client_gets': 'What the client gets',
  'scheduling.modal.section.sold_paid': 'How it is sold and paid',
  'scheduling.modal.shape.card': 'They pay by card',
  'scheduling.modal.shape.invoice': 'You invoice them',
  'scheduling.modal.shape.quote': 'You quote first',
  'scheduling.modal.collection.online.why': 'Paid at the moment of booking. Needs a connected processor.',
  'scheduling.modal.collection.invoice.why': 'Billed afterwards. No processor needed.',
  'config.services.sale_mode.proposal.why': 'The client sends a request instead.',
  'config.services.collection.no_processor': 'Card payments need a connected processor.',
  'scheduling.modal.quote_note': 'No price here, on purpose: you name the amount in each quote.',
  'config.services.needs_time.yes': 'Yes',
  'config.services.needs_time.no': 'No',
  'config.services.column.price': 'Price',
  'config.services.column.duration': 'Duration',
  'config.services.eg': 'For example:',
  'config.services.shape.card.eg': 'They book at 9pm and the money is already in.',
  'config.services.shape.invoice.eg': 'Bank transfer, Bit, or cash on the day.',
  'config.services.shape.invoice.why_link': 'Billed afterwards. The invoice goes out with a payment link.',
  'config.services.shape.invoice.eg_link': 'They open the email at midnight and pay the invoice by card.',
  'config.services.shape.quote.eg': 'A kitchen renovation priced after a site visit.',
  'config.services.needs_time.yes.why': 'The client picks a time, and it is held in your calendar.',
  'config.services.needs_time.yes.eg': 'A session, a treatment, a haircut.',
  'config.services.needs_time.no.why': 'Nothing is held in your calendar. They buy it and start.',
  'config.services.needs_time.no.eg': 'A six-week course, a programme, a downloadable plan.',
  'scheduling.modal.you_get_paid': 'You get paid',
  'journey.label': 'What your client sees',
  'scheduling.modal.money.invoice_once': 'You send one invoice for {amount}.',
  'scheduling.modal.money.invoice_once_link': 'You send one invoice for {amount}, with a payment link in it.',
  'scheduling.modal.money.card_once': 'They pay {amount} by card at the moment they buy.',
  'scheduling.modal.money.card_no_stripe': 'While Stripe is not connected you invoice {amount} after they buy.',
  'scheduling.modal.money.quote': 'Nothing is charged here.',
  'scheduling.modal.money.free': 'Nothing is collected. This service is free.',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
    formatCurrency: (value: number) => `₪${value}`,
  }),
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
    <div
      data-testid="journey"
      data-scheduled={String(service.scheduled)}
      data-collection={String(service.collection)}
    />
  ),
}));

import { SchedulingServicesList } from '../SchedulingServicesList';

/** An invoiced appointment at ₪300, which is where most accounts start. */
const SERVICE = {
  id: 'svc-1',
  service_name: 'Individual Therapy Session',
  description: 'A 50-minute session.',
  duration_minutes: 50,
  buffer_minutes: 15,
  price: 300,
  currency: 'ILS',
  status: 'active',
  is_active: true,
  is_scheduled: true,
  sale_mode: 'direct',
  collection: 'invoice',
  payment_type: 'full',
  installment_count: 1,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
} as unknown as SchedulingService;

const settle = () => act(async () => { await Promise.resolve(); });

/** Opens the panel for the one service, which is what clicking its row does. */
async function openEditor(options: { processorReady?: boolean; service?: SchedulingService } = {}) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response)
  ) as unknown as typeof fetch;

  const service = options.service ?? SERVICE;
  render(
    <SchedulingServicesList
      services={[service]}
      processorReady={options.processorReady ?? true}
      intakeEnabled={false}
    />
  );

  fireEvent.click(screen.getByText(service.service_name as string));
  await settle();
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('the questions it asks', () => {
  it('asks two, not three, and names each section', async () => {
    await openEditor();

    expect(screen.getByText('The service')).toBeInTheDocument();
    expect(screen.getByText('What the client gets')).toBeInTheDocument();
    expect(screen.getByText('How it is sold and paid')).toBeInTheDocument();

    // The three shapes are one question, asked before any price is typed.
    expect(screen.getByRole('button', { name: 'They pay by card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'You invoice them' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'You quote first' })).toBeInTheDocument();
  });

  it('opens on the shape the service already has, and says what it means', async () => {
    await openEditor();

    expect(screen.getByText(/Billed afterwards/)).toBeInTheDocument();
    // Stripe is connected in this mount, so the invoice carries its link.
    expect(screen.getByText(/one invoice for ₪300, with a payment link/)).toBeInTheDocument();
  });

  it('says what an invoice really is on each side of Stripe', async () => {
    await openEditor();

    // Connected: the invoice goes out with its hosted payment page, so the
    // client can pay it by card from the email.
    expect(screen.getByText(/goes out with a payment link/)).toBeInTheDocument();
    expect(screen.getByText(/pay the invoice by card/)).toBeInTheDocument();
  });

  it('and promises no link when there is no processor', async () => {
    await openEditor({ processorReady: false });

    expect(screen.getByText(/No processor needed/)).toBeInTheDocument();
    expect(screen.getByText(/Bank transfer, Bit, or cash on the day/)).toBeInTheDocument();
    expect(screen.queryByText(/payment link/)).not.toBeInTheDocument();
  });

  it('explains the chosen option with a concrete example', async () => {
    await openEditor();

    // Under the pills, naming the option it belongs to, with a real case — the
    // definition alone is what testers misread.
    expect(screen.getByText(/pay the invoice by card/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'You quote first' }));
    expect(screen.getByText(/kitchen renovation priced after a site visit/)).toBeInTheDocument();
    expect(screen.queryByText(/pay the invoice by card/)).not.toBeInTheDocument();
  });

  it('explains the appointment question too, which had nothing', async () => {
    await openEditor();

    expect(screen.getByText(/A session, a treatment, a haircut/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.getByText(/six-week course, a programme/)).toBeInTheDocument();
  });
});

describe('pressing a shape', () => {
  it('card writes collection online, and the journey is handed the same pair', async () => {
    await openEditor();

    fireEvent.click(screen.getByText('They pay by card'));

    expect(screen.getByTestId('journey')).toHaveAttribute('data-collection', 'online');
    expect(screen.getByText(/They pay ₪300 by card at the moment they buy/)).toBeInTheDocument();
  });

  it('a quote takes the price away and says why', async () => {
    await openEditor();

    fireEvent.click(screen.getByText('You quote first'));

    expect(screen.getByText(/No price here, on purpose/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged here/)).toBeInTheDocument();
  });
});

describe('the processor the owner cannot see', () => {
  it('warns at the choice, and the sentence says INVOICED', async () => {
    await openEditor({ processorReady: false });

    fireEvent.click(screen.getByText('They pay by card'));

    expect(screen.getByText(/Card payments need a connected processor/)).toBeInTheDocument();
    expect(
      screen.getByText(/While Stripe is not connected you invoice ₪300 after they buy/)
    ).toBeInTheDocument();
  });
});

describe('a service with no appointment', () => {
  it('stops asking for a length, and tells the journey', async () => {
    await openEditor();

    expect(screen.getByText('Duration')).toBeInTheDocument();

    fireEvent.click(screen.getByText('No'));

    expect(screen.queryByText('Duration')).not.toBeInTheDocument();
    expect(screen.getByTestId('journey')).toHaveAttribute('data-scheduled', 'false');
  });
});

describe('a free service', () => {
  it('keeps its shape and says nothing is collected', async () => {
    await openEditor({ service: { ...SERVICE, price: 0 } as unknown as SchedulingService });

    expect(screen.getByText(/Nothing is collected. This service is free/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'You invoice them' })).toBeInTheDocument();
  });
});
