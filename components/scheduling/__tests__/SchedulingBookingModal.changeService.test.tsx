/**
 * @jest-environment jsdom
 *
 * Changing the service a SECOND time does something.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Reported as: "I choose a service and then click on update to select another
 * service, the next time it does nothing, not switching the elements of the
 * new service."
 *
 * `planBookingSteps` gives a REOPENED step priority over the natural order —
 * `reopened ?? natural` — and nothing but opening the dialog ever cleared it.
 * So:
 *
 *   1. pick a service     `openedStep` is null, so the natural order moves on
 *                         to the next unanswered step and the dialog visibly
 *                         advances
 *   2. press Change       `openedStep` becomes 'service', pinned for the rest
 *                         of the dialog's life
 *   3. pick another       the form updates underneath, but the open step is
 *                         still 'service' — nothing moves, and the new
 *                         service's steps never come forward
 *
 * The first pick works and every later one appears dead, which is exactly the
 * shape of the report. `handleServiceChange` now releases the step, because
 * the owner has just answered the question it asks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ITS OWN FILE
 *
 * `SchedulingBookingModal.steps.test.tsx` mocks `Select` as plain divs and
 * drops `onValueChange`, so no test there can change a service at all — which
 * is why this went unnoticed. Widening that mock would alter the harness ten
 * other tests in that file rely on, so the interactive mock lives here instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const COPY: Record<string, string> = {
  'scheduling.booking.service_section': 'Service',
  'scheduling.booking.client_info': 'Client',
  'scheduling.booking.time_section': 'Date and time',
  'scheduling.booking.step_details': 'Details',
  'scheduling.booking.step_change': 'Change',
  'scheduling.booking.service': 'Service',
  'scheduling.booking.select_service': 'Choose a service',
  'scheduling.service.minutes': 'min',
  'scheduling.booking.new_booking': 'New booking',
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

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/*
 * The one mock that differs from the steps harness: a `SelectItem` the test can
 * actually press, named by its VALUE so the assertion does not depend on how
 * the two-row item renders its name, duration and price.
 */
jest.mock('@/components/ui/select', () => {
  const React = require('react');
  const Chosen = React.createContext<((value: string) => void) | undefined>(undefined);

  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => <Chosen.Provider value={onValueChange}>{children}</Chosen.Provider>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const choose = React.useContext(Chosen);
      return (
        <button type="button" aria-label={value} onClick={() => choose?.(value)}>
          {children}
        </button>
      );
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

jest.mock('@/components/crm/SearchableCountrySelect', () => ({
  SearchableCountrySelect: () => <div data-testid="country" />,
}));

import { SchedulingBookingModal } from '../SchedulingBookingModal';
import type { SchedulingBooking, SchedulingService } from '@/lib/repositories/SchedulingRepository';

const SERVICE = {
  id: 'svc-1',
  service_name: 'Individual Therapy',
  duration_minutes: 50,
  buffer_minutes: 0,
  price: 300,
  currency: 'ILS',
  status: 'active',
  is_active: true,
  is_scheduled: true,
  sale_mode: 'direct',
} as unknown as SchedulingService;

const SECOND = {
  ...SERVICE,
  id: 'svc-2',
  service_name: 'Couples Therapy',
  duration_minutes: 80,
  price: 450,
} as unknown as SchedulingService;

/** A saved appointment, whose hour is a fact rather than a draft. */
const BOOKING = {
  id: 'bk-1',
  service_id: 'svc-1',
  contact_id: 'ct-1',
  client_first_name: 'Dana',
  client_last_name: 'Cohen',
  client_email: 'dana@example.com',
  client_phone: '',
  start_time: '2026-11-20T08:00:00.000Z',
  end_time: '2026-11-20T08:50:00.000Z',
  status: 'confirmed',
  notes: '',
} as unknown as SchedulingBooking;

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function stubFetch() {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/intake/settings')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, settings: { is_enabled: false, hasPublishedForm: false } }),
      } as Response);
    }

    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          services: [],
          contacts: [],
          data: {},
          timezone: 'Asia/Jerusalem',
          availabilityConfigured: true,
          durationMinutes: 50,
          selectedDate: '2026-11-20',
          days: [],
          slots: [],
          suggestions: [],
          nextFree: null,
        }),
    } as Response);
  }) as unknown as typeof fetch;
}

/** Opens on a service already chosen, so the service step starts collapsed. */
async function openWithAService() {
  stubFetch();

  render(
    <SchedulingBookingModal
      services={[SERVICE, SECOND]}
      isOpen
      onClose={jest.fn()}
      onBookingUpdated={jest.fn()}
      timezone="Asia/Jerusalem"
      prefilledServiceId="svc-1"
    />
  );
  await settle();
}

const serviceStepIsCollapsed = () =>
  screen.queryByRole('button', { name: 'Change · Service' }) !== null;

afterEach(() => jest.clearAllMocks());

describe('changing the service after it has already been answered', () => {
  it('starts collapsed, with a way back in', async () => {
    await openWithAService();

    expect(serviceStepIsCollapsed()).toBe(true);
  });

  it('reopens when the owner asks to change it', async () => {
    await openWithAService();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change · Service' }));
    });

    /* Open means the picker is back and the collapsed line with its link is not. */
    expect(serviceStepIsCollapsed()).toBe(false);
  });

  it('and CLOSES again once another service is chosen', async () => {
    /*
     * The regression. Before the fix the step stayed open here for ever, so
     * every pick after the first one looked like a dead control.
     */
    await openWithAService();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change · Service' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'svc-2' }));
    });
    await settle();

    expect(serviceStepIsCollapsed()).toBe(true);
  });

  it('keeps the client, which never belonged to the service', async () => {
    /*
     * The swap re-asks the service's OWN questions. A client is not one of
     * them, and it is the owner's typing — the thing
     * `a services list that changes while the dialog is open` protects from a
     * different cause.
     */
    await openWithAService();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'scheduling.booking.client_new' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('scheduling.booking.email_placeholder'), {
        target: { value: 'eyal@example.com' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change · Service' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'svc-2' }));
    });
    await settle();

    expect(screen.getByDisplayValue('eyal@example.com')).toBeInTheDocument();
  });

  it('a third time too, so it is not a one-shot release', async () => {
    await openWithAService();

    for (const next of ['svc-2', 'svc-1', 'svc-2']) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Change · Service' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: next }));
      });
      await settle();

      expect(serviceStepIsCollapsed()).toBe(true);
    }
  });
});

describe('correcting the service on a booking that already exists', () => {
  const openTheBooking = async () => {
    stubFetch();

    render(
      <SchedulingBookingModal
        services={[SERVICE, SECOND]}
        isOpen
        onClose={jest.fn()}
        onBookingUpdated={jest.fn()}
        timezone="Asia/Jerusalem"
        booking={BOOKING}
      />
    );
    await settle();
  };

  it('does NOT empty the appointment’s hour', async () => {
    /*
     * The limit on the reset. A draft's hour is a guess against the old
     * duration and is worth re-asking; a SAVED appointment's hour is a fact,
     * and the client may already be holding it in a confirmation email.
     *
     * Read through the step: the date step stays collapsed with its way back
     * in, which it can only be while it still has an answer. Had the swap
     * cleared the time, the step would have reopened and this button would be
     * gone.
     */
    await openTheBooking();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change · Service' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'svc-2' }));
    });
    await settle();

    expect(screen.getByRole('button', { name: 'Change · Date and time' })).toBeInTheDocument();
  });
});
