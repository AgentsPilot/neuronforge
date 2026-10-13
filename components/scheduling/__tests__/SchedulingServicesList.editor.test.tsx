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
import * as fs from 'fs';
import * as path from 'path';
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
  'scheduling.modal.how_it_works': 'You get paid',
  'journey.label': 'What your client sees',
  'scheduling.new_service': 'Add a service',
  'scheduling.journey.holds_time': 'Booking this holds a time in your diary.',
  'scheduling.journey.no_time': 'Nothing is held in your diary. They buy it and begin.',
  'scheduling.journey.runs_for': 'Each booking runs {minutes} minutes.',
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

/**
 * The account now renders TWICE: beside each section from `md:` up, and
 * stacked at the foot of the form below that. Only one is ever visible --
 * Tailwind hides the other with `display:none` -- but jsdom applies no CSS, so
 * both are in the document here.
 *
 * Asserting through this rather than loosening every query, because the real
 * risk of having two shapes is that they DRIFT. This fails if they ever say
 * different things.
 */
function says(match: RegExp) {
  const found = screen.getAllByText(match);
  expect(found.length).toBeGreaterThan(0);
  const texts = new Set(found.map(el => el.textContent?.replace(/\s+/g, ' ').trim()));
  expect(texts.size).toBe(1);
  return found[0];
}


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

    // Stripe is connected in this mount, so the invoice carries its link.
    says(/one invoice for ₪300, with a payment link/);
  });

  it('says what an invoice really is on each side of Stripe', async () => {
    /*
     * This used to read the `why` note under the chosen shape. That note is
     * gone -- the flow beside the section says the same thing with the real
     * figures -- but the DISTINCTION it protected is not: with Stripe the
     * invoice carries a hosted payment page, and the sentence has to say so.
     *
     * `serviceMoneyLine` decides it (`invoice_once` against
     * `invoice_once_link`), which is why the test now asks the sentence rather
     * than the note.
     */
    await openEditor();
    says(/one invoice for ₪300, with a payment link/);
  });

  it('and promises no link when there is no processor', async () => {
    await openEditor({ processorReady: false });

    says(/You send one invoice for ₪300\./);
    expect(screen.queryByText(/payment link/)).not.toBeInTheDocument();
  });

  it('changes what it says when the shape changes', async () => {
    /*
     * This used to assert the worked example under the pills. The examples are
     * gone with the notes -- the flow says what the choice produces, with this
     * service's own figures, which is a better example than an invented one.
     *
     * What the test still has to hold is that the account FOLLOWS the choice:
     * pick quote and the money sentence must stop describing an invoice.
     */
    await openEditor();
    says(/one invoice for ₪300/);

    fireEvent.click(screen.getByRole('button', { name: 'You quote first' }));
    says(/Nothing is charged here/);
    expect(screen.queryByText(/one invoice for ₪300/)).not.toBeInTheDocument();
  });

  it('answers the appointment question on the flow, not under the control', async () => {
    /*
     * This used to assert the `eg` lines under the segmented choice -- "A
     * session, a treatment, a haircut" / "a six-week course, a programme".
     * They are gone, and deliberately: the flow beside this section says the
     * same thing and says it whole, and two answers to one question a
     * centimetre apart is how an owner learns to read neither.
     */
    await openEditor();
    says(/holds a time in your diary/);

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    says(/Nothing is held in your diary/);
  });

  it('and does not also say it under the control', () => {
    // The removal is the point. If these come back, the section says the same
    // thing twice, which is what the flow was built to end.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/scheduling/SchedulingServicesList.tsx'),
      'utf8'
    );
    expect(source).not.toContain("config.services.needs_time.yes.why");
    expect(source).not.toContain("config.services.needs_time.no.eg");
  });
});

describe('pressing a shape', () => {
  it('card writes collection online, and the journey is handed the same pair', async () => {
    await openEditor();

    fireEvent.click(screen.getByText('They pay by card'));

    expect(screen.getByTestId('journey')).toHaveAttribute('data-collection', 'online');
    says(/They pay ₪300 by card at the moment they buy/);
  });

  it('a quote takes the price away and says why', async () => {
    await openEditor();

    fireEvent.click(screen.getByText('You quote first'));

    says(/No price here, on purpose/);
    says(/Nothing is charged here/);
  });
});

describe('the processor the owner cannot see', () => {
  it('warns at the choice, and the sentence says INVOICED', async () => {
    await openEditor({ processorReady: false });

    fireEvent.click(screen.getByText('They pay by card'));

    says(/Card payments need a connected processor/);
    says(/While Stripe is not connected you invoice ₪300 after they buy/);
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

    says(/Nothing is collected. This service is free/);
    expect(screen.getByRole('button', { name: 'You invoice them' })).toBeInTheDocument();
  });
});


describe('creating a service, where there is no saved row yet', () => {
  /*
   * The journey reads the booking window off the SAVED service, and while a
   * new one is being created there is none -- `effective` is null. The question
   * is whether the account of what will happen still appears, or whether the
   * owner creating their first service is the one person who never sees it.
   *
   * It should, and it should describe what they are typing: a new service gets
   * the platform's defaults on save, and a line restating a default is dropped
   * anyway, so what is left is exactly the part they chose.
   */
  const openNew = async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response)
    ) as unknown as typeof fetch;

    render(<SchedulingServicesList services={[]} processorReady showAddButton intakeEnabled={false} />);
    fireEvent.click(screen.getByText('Add a service'));
    await settle();
  };

  it('still explains what will happen', async () => {
    await openNew();
    // A new service starts scheduled, so this is the line it opens on.
    says(/Booking this holds a time in your diary/);
  });

  it('and does not fall over on the fields that have no saved value', async () => {
    // `advance_booking_days`, `min_notice_hours` and the day cap are all read
    // from a row that does not exist yet. Null, not a crash, and no sentence.
    await openNew();
    expect(screen.queryByText(/days ahead/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hours before the start/)).not.toBeInTheDocument();
  });

  it('describes the money too, from the fields as typed', async () => {
    // The new row starts with no price, so the one true sentence about money
    // is that nothing is collected.
    await openNew();
    says(/Nothing is collected/);
  });
});


describe('a service with no price', () => {
  /*
   * At a price of nothing `serviceMoneyLine` answers `free` and never consults
   * the shape -- so card, invoice and quote were offered, one of them lit,
   * deciding nothing. The payment-plan row already collapsed on the same test.
   */
  const FREE = { ...SERVICE, price: 0, collection: 'invoice' } as unknown as SchedulingService;

  it('does not ask how they pay', async () => {
    await openEditor({ service: FREE });
    for (const name of ['They pay by card', 'You invoice them', 'You quote first']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('and says the service is free', async () => {
    await openEditor({ service: FREE });
    says(/Nothing is collected/);
  });

  it('while a priced service still asks', async () => {
    await openEditor();
    expect(screen.getByRole('button', { name: 'You quote first' })).toBeInTheDocument();
  });
});
