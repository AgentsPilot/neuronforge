/**
 * @jest-environment jsdom
 *
 * The service editor in the settings dialog — the one owners actually use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUITE IS NOW, AND WHAT IT WAS
 *
 * It was 33 cases against a one-page panel that asked everything at once: find
 * a heading by its English copy, read the sentence underneath, assert the
 * arrangement it described. The panel is a four-step wizard now
 * (`ServiceWizard`), so every one of those queries pointed at markup that no
 * longer exists.
 *
 * The RULES those cases protected did not change, and they were never really
 * about markup: which of the three shapes a service has, what each one implies
 * for the stored columns, and what an owner is asked as a result. Those are
 * `lib/business-os/serviceWizard.ts`, and they are asserted directly in
 * `lib/business-os/__tests__/serviceWizard.test.ts` — 25 cases, no DOM.
 *
 * What is left here is what only a render can show: that the editor mounts the
 * wizard on the right service, that pressing a shape does something an owner
 * can see, and that the one truth an owner CANNOT see is told — a card service
 * on an account with no processor is invoiced, and nobody is turned away.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
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

/** Opens the panel for one service, which is what clicking its row does. */
async function openEditor(
  options: { processorReady?: boolean; service?: Partial<SchedulingService> } = {}
) {
  /*
   * Answers PER URL, because the list no longer takes the processor from its
   * prop alone: it reads `/api/payments/stripe-connect` and
   * `/api/plugin-connections` live, so that an owner who connects Stripe from
   * the publish step stops being told to connect one. A blanket `{success:
   * true}` makes every account look unconnected, which is a true answer to a
   * question this fixture was not meaning to ask.
   */
  const connected = options.processorReady ?? true;
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body =
      url.includes('/api/payments/stripe-connect')
        ? {
            success: true,
            data: connected
              ? { charges_enabled: true, details_submitted: true, paused_at: null }
              : null,
          }
        : url.includes('/api/plugin-connections')
          ? { plugins: [] }
          : { success: true };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;

  const service = { ...SERVICE, ...(options.service ?? {}) } as SchedulingService;
  render(
    <SchedulingServicesList
      services={[service]}
      processorReady={options.processorReady ?? true}
      intakeEnabled={false}
    />
  );

  fireEvent.click(screen.getByText(service.service_name as string));
  await settle();
  return service;
}

/** Walks to a step by pressing Continue, which is how an owner gets there. */
async function goOn(times = 1) {
  for (let i = 0; i < times; i += 1) {
    const button = screen.getByText('Continue').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await settle();
  }
}

afterEach(() => {
  /* Auto-cleanup is not on in this project's setup, and without this the next
     case queries the editor the previous one left open. */
  cleanup();
  jest.clearAllMocks();
});

describe('the editor opens on the service', () => {
  it('mounts the wizard, on the row that was clicked', async () => {
    await openEditor();

    /* The name is the wizard's own heading and its first field. */
    const values = Array.from(document.querySelectorAll('input')).map(
      input => (input as HTMLInputElement).value
    );
    expect(values).toContain('Individual Therapy Session');
    /* One question at a time: the cost answers are a step away, not on screen. */
    expect(screen.queryByText('I charge a set price')).not.toBeInTheDocument();
  });

  it('asks what the client does, beside the question being answered', async () => {
    await openEditor();

    /* The rail, which is the account of the service the old panel printed at
       the foot of the form. Both presentations carry it, and jsdom applies no
       CSS, so either one satisfies this. */
    expect(screen.getAllByText(/What your client (does|sees)/).length).toBeGreaterThan(0);
  });
});

describe('pressing a shape', () => {
  it('a set price stays chosen, and asks for the amount', async () => {
    /*
     * The reported bug, in the owner's words: "I charge a set price does not
     * work. Clicking on it nothing happens." The shape was derived from the
     * price, so the one answer that needs a figure could not record itself.
     */
    /*
     * Every service opens on the FIRST step now, so the name can be changed
     * without a Back press nobody expects. The cost question is one Continue
     * away, and the amount field is not on screen until the shape asking for
     * it is chosen. That field appearing IS the fix: the owner pressed the
     * option and nothing opened.
     */
    await openEditor({ service: { price: null as unknown as number } });
    await goOn();

    expect(document.querySelectorAll('input')).toHaveLength(0);

    fireEvent.click(screen.getByText('I charge a set price').closest('button') as HTMLButtonElement);
    await settle();

    expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
    /* And Continue stays shut until a real figure is typed, which is honest:
       the question is chosen, not answered. */
    expect((screen.getByText('Continue').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a quote takes the price away', async () => {
    await openEditor();
    await goOn();

    fireEvent.click(screen.getByText('I price it per job').closest('button') as HTMLButtonElement);
    await settle();

    /* 300 was the service's price; a quote names the amount per job instead. */
    const values = Array.from(document.querySelectorAll('input')).map(
      input => (input as HTMLInputElement).value
    );
    expect(values).not.toContain('300');
  });

  it('free says nothing is collected, and stops asking how they pay', async () => {
    await openEditor();
    await goOn();

    fireEvent.click(screen.getByText('It is free').closest('button') as HTMLButtonElement);
    await settle();

    expect(screen.getAllByText(/Nothing is collected/).length).toBeGreaterThan(0);
    /* And the money step is gone from the walk: Continue goes to the review. */
    await goOn();
    expect(screen.queryByText('Continue')).not.toBeInTheDocument();
  });
});

describe('the processor the owner cannot see', () => {
  it('says a card service is invoiced for now when nothing is connected', async () => {
    /*
     * THE ONE TRUTH AN OWNER CANNOT SEE FOR THEMSELVES, and the reason this
     * suite still renders anything: with no Stripe account, a service set to
     * card is billed rather than charged. Said plainly, with the reassurance
     * that the booking still happens.
     */
    await openEditor({ processorReady: false, service: { collection: 'online' } });

    expect(screen.getAllByText(/Gets an invoice, for now/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No card account yet/).length).toBeGreaterThan(0);
  });

  it('and says it is charged at booking once there is one', async () => {
    await openEditor({ processorReady: true, service: { collection: 'online' } });

    expect(screen.getAllByText(/Pays by card/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Gets an invoice, for now/)).not.toBeInTheDocument();
  });
});

describe('a service with no appointment', () => {
  it('stops asking for a length', async () => {
    await openEditor({ service: { is_scheduled: false } });

    /* 50 was the length of the appointment this service no longer holds. */
    const values = Array.from(document.querySelectorAll('input')).map(
      input => (input as HTMLInputElement).value
    );
    expect(values).not.toContain('50');
  });
});

describe('publishing a draft', () => {
  it('offers Publish on an untouched draft, and Save only once something changed', async () => {
    await openEditor({ service: { status: 'draft', is_active: false } });
    /* Walk to the review: what it is, what it costs, how it arrives. */
    await goOn(3);

    const save = screen.getByText('Keep as a draft').closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('title')).toBe('Nothing has changed yet');

    expect(screen.getByText('Publish').closest('button')).toBeInTheDocument();
  });
});
