/**
 * @jest-environment jsdom
 *
 * The dialog collapses, and every way it is opened still works.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Five places open this dialog — the scheduling page, the Business OS diary,
 * both CRM drawers, and the package slot picker — in four shapes:
 *
 *   NEW            nothing answered, asks for the service
 *   EDITING        every fact answered, each collapsed to a line
 *   SETTLED        completed or cancelled: read, and nothing to change
 *   PICK A SLOT    service and client came with it; only the hour is asked
 *
 * Collapsing is what is new, and the thing it can most easily break is the
 * one it is for: an EXISTING booking, where every answer is already there, so
 * every step collapses at once and the dialog could present four ticks and no
 * way back in. Each shape is asserted here by what the owner can see and
 * press, not by which section happens to be mounted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const COPY: Record<string, string> = {
  'scheduling.booking.service_section': 'Service',
  'scheduling.booking.client_info': 'Client',
  'scheduling.booking.time_section': 'Date and time',
  'scheduling.booking.exact_time_section': 'Exact time',
  'scheduling.booking.step_details': 'Details',
  'scheduling.booking.step_change': 'Change',
  'scheduling.booking.details_notes_added': 'Notes added',
  'scheduling.booking.details_intake_will_send': 'Intake form will be sent',
  'scheduling.booking.service': 'Service',
  'scheduling.booking.start_time': 'Starts',
  'scheduling.booking.end_time': 'Ends',
  'scheduling.booking.select_service': 'Choose a service',
  'scheduling.booking.client_existing': 'A client you have',
  'scheduling.booking.notes_section': 'Notes',
  'scheduling.service.minutes': 'min',
  'scheduling.booking.edit_booking': 'Edit booking',
  'scheduling.booking.new_booking': 'New booking',
  'scheduling.booking.time_locked': 'locked',
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

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

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
  collection: 'invoice',
} as unknown as SchedulingService;

/** Bought, not booked into an hour: its journey has no date step. */
const COURSE = {
  ...SERVICE,
  id: 'svc-course',
  service_name: 'ADHD Course',
  is_scheduled: false,
  sale_mode: 'direct',
} as unknown as SchedulingService;

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

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** Every request this dialog makes, so the slot grid's query can be read. */
let requested: string[] = [];

/** Whether the business has a published, enabled client form. */
let intakeLive = false;

function stubFetch() {
  requested = [];
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);

    if (url.includes('/api/intake/settings')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            settings: { is_enabled: intakeLive, hasPublishedForm: intakeLive },
          }),
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
          /* Enough of a free-slots body that the grid renders rather than
             throwing while we assert on the steps around it. */
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

async function open(props: Record<string, unknown>) {
  stubFetch();

  render(
    <SchedulingBookingModal
      services={[SERVICE, COURSE]}
      isOpen
      onClose={jest.fn()}
      onBookingUpdated={jest.fn()}
      timezone="Asia/Jerusalem"
      {...props}
    />
  );
  await settle();
}

afterEach(() => {
  jest.clearAllMocks();
  intakeLive = false;
});

describe('a new booking', () => {
  it('asks for the service first, and nothing else yet', async () => {
    /*
     * It used to open on `activeServices[0]` and ask for the client. That was
     * a guess presented as an answer, and collapsed to a summary line it reads
     * as a decision the owner made — carrying the price of whichever service
     * sorted first.
     */
    await open({});

    expect(screen.queryByText('Individual Therapy · 50 min · ₪300')).not.toBeInTheDocument();
  });

  it('so the client is not asked about yet, nor the hour typed in', async () => {
    await open({});

    expect(screen.queryByText('A client you have')).not.toBeInTheDocument();
    expect(screen.queryByText('Exact time')).not.toBeInTheDocument();
  });

  it('and nothing collapses, because nothing has been answered', async () => {
    await open({});

    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
  });

  it('while a caller that named a service skips straight past it', async () => {
    /* A drawer opening a known service has already had this conversation. */
    await open({ prefilledServiceId: 'svc-1' });

    /* Twice over: the collapsed step, and the footer line beside Save. */
    expect(screen.getAllByText('Individual Therapy · 50 min · ₪300').length).toBeGreaterThan(0);
    expect(screen.getByText('A client you have')).toBeInTheDocument();
  });
});

describe('closing a booking that was never finished', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * Every caller keeps this component MOUNTED and toggles `isOpen`, so closing
   * the dialog unmounts nothing and the form state survives. `isOpen` was not
   * among the initialising effect's dependencies either, so reopening did not
   * re-run it — an owner who half-filled a booking, thought better of it and
   * closed found all of it still there next time. In the CRM drawer, which
   * reuses one instance, that could be against a different client.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const props = {
    services: [SERVICE, COURSE],
    onClose: jest.fn(),
    onBookingUpdated: jest.fn(),
    timezone: 'Asia/Jerusalem',
    prefilledServiceId: 'svc-1',
  };

  const openHalfFillAndClose = async () => {
    stubFetch();

    const { rerender } = render(<SchedulingBookingModal isOpen {...props} />);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'scheduling.booking.client_new' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('scheduling.booking.email_placeholder'), {
        target: { value: 'half@typed.example' },
      });
    });

    /* Closed without saving: the component stays mounted. */
    rerender(<SchedulingBookingModal isOpen={false} {...props} />);
    await settle();

    return async () => {
      rerender(<SchedulingBookingModal isOpen {...props} />);
      await settle();
    };
  };

  it('starts again when it is reopened', async () => {
    const reopen = await openHalfFillAndClose();
    await reopen();

    expect(screen.queryByDisplayValue('half@typed.example')).not.toBeInTheDocument();
  });

  it('including the mode the owner had switched to', async () => {
    const reopen = await openHalfFillAndClose();
    await reopen();

    /* Back on the search box, not on the new-client form. */
    expect(screen.getByRole('button', { name: 'A client you have' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('while the caller\'s own service is still filled in', async () => {
    /* Starting again is not starting from nothing: what the CALLER said
       survives, because it is not the owner's half-finished work. */
    const reopen = await openHalfFillAndClose();
    await reopen();

    expect(screen.getAllByText('Individual Therapy · 50 min · ₪300').length).toBeGreaterThan(0);
  });
});

describe('a services list that changes while the dialog is open', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The reported fault: "when selecting service from the drop down it gets
   * jumpy and sometimes it changed it to default after selection".
   *
   * The effect that initialises the form lists `services` and `availability`
   * among its dependencies — both arrive after the dialog opens, and the CRM
   * drawer refetches services in several places. Each arrival is a new array
   * identity, so every one of them performed a FULL reset of the form. Losing
   * a chosen service and losing a typed email were the same bug.
   *
   * A re-run may now only replace defaults nobody has changed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const open2 = async (services: unknown[]) => {
    stubFetch();

    const props = {
      isOpen: true,
      onClose: jest.fn(),
      onBookingUpdated: jest.fn(),
      timezone: 'Asia/Jerusalem',
      prefilledServiceId: 'svc-1',
    };

    const { rerender } = render(
      // @ts-expect-error -- the harness passes the modal's own prop shape
      <SchedulingBookingModal services={services} {...props} />
    );
    await settle();

    /* Pass a list to simulate an arrival; pass nothing for a refetch of the
       same services, which is a new array identity either way. */
    return async (next?: unknown[]) => {
      rerender(
        // @ts-expect-error -- see above
        <SchedulingBookingModal services={next ?? [...services]} {...props} />
      );
      await settle();
    };
  };

  it('does not wipe what the owner has already typed', async () => {
    const refetch = await open2([SERVICE, COURSE]);

    /* Mid-sentence, as an owner filling in a new client would be. */
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'scheduling.booking.client_new' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('scheduling.booking.email_placeholder'), {
        target: { value: 'dana@example.com' },
      });
    });

    await refetch();

    expect(screen.getByDisplayValue('dana@example.com')).toBeInTheDocument();
  });

  it('nor the mode the owner chose', async () => {
    const refetch = await open2([SERVICE, COURSE]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'scheduling.booking.client_new' }));
    });
    await refetch();

    /* A reset would have put them back on the search box. */
    expect(
      screen.getByRole('button', { name: 'scheduling.booking.client_new' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('while an untouched dialog still takes the better defaults', async () => {
    /*
     * The reason `services` and `availability` are in those dependencies at
     * all: a late diary corrects a start time derived without it, and a late
     * list resolves the service the caller named. Both must still happen —
     * just not over the owner's own answers.
     */
    const servicesArrive = await open2([]);

    /* Nothing resolvable yet: the caller named a service that is not in an
       empty list. */
    expect(screen.queryByText('Individual Therapy · 50 min · ₪300')).not.toBeInTheDocument();

    await servicesArrive([SERVICE, COURSE]);

    expect(screen.getAllByText('Individual Therapy · 50 min · ₪300').length).toBeGreaterThan(0);
  });
});

describe('the hour, which is asked rather than assumed', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * It used to arrive pre-filled with the next free slot, and once an answered
   * step collapses to a line that default became a decision the owner had
   * supposedly made — "Monday 19 Oct · 11:30", with the grid that would have
   * explained it shut behind it.
   *
   * Two things live in that step, and both are machinery rather than advice: a
   * meeting under 24 hours out never gets its 24-hour reminder, and a client
   * form emailed on confirmation has only the hours until the meeting to come
   * back. An hour nobody opened is an hour booked without either.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const upToTheHour = async () => {
    await open({ prefilledServiceId: 'svc-1' });

    /* The client step opens on the search box; the fields are the other mode. */
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'scheduling.booking.client_new' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('scheduling.booking.email_placeholder'), {
        target: { value: 'dana@example.com' },
      });
    });
    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText('scheduling.booking.first_name_placeholder'),
        { target: { value: 'Dana' } }
      );
    });
    await settle();
  };

  it('is not answered on open, so the step stays shut over nothing', async () => {
    await open({ prefilledServiceId: 'svc-1' });

    /* No summary line, and no request for a diary nobody has asked about. */
    expect(
      screen.queryByRole('button', { name: 'Change · Date and time' })
    ).not.toBeInTheDocument();
    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(false);
  });

  it('and opens as the next question once the client is known', async () => {
    await upToTheHour();

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(true);
  });

  it('with Save refused until an hour is chosen', async () => {
    /* The validator refuses it anyway; a pressable button for an answer the
       dialog already knows is wrong is a round trip for nothing. */
    await upToTheHour();

    expect(
      screen.getByRole('button', { name: 'scheduling.booking.create_booking' })
    ).toBeDisabled();
  });
});

describe('editing a booking that already has every answer', () => {
  it('shows each answer rather than four ticks', async () => {
    await open({ booking: BOOKING });

    expect(screen.getByText('Individual Therapy · 50 min · ₪300')).toBeInTheDocument();
    expect(screen.getByText('Dana Cohen · dana@example.com')).toBeInTheDocument();
  });

  it('names each way back in by the fact it reopens', async () => {
    /* Four buttons reading "Change" are four identical buttons to anybody
       navigating by name. */
    await open({ booking: BOOKING });

    expect(screen.getByRole('button', { name: 'Change · Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change · Client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change · Date and time' })).toBeInTheDocument();
  });

  it('and reopening one puts its form back, without losing the other answers', async () => {
    await open({ booking: BOOKING });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change · Client' }));
    });

    /*
     * The client step's own FIELDS are back — asserted by the value in one of
     * them, which exists nowhere while the step is collapsed to a summary line.
     * The service above still reads as the line it collapsed to.
     */
    expect(screen.getByDisplayValue('dana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Individual Therapy · 50 min · ₪300')).toBeInTheDocument();
  });

  it('asks nothing of the slot endpoint while the hour is collapsed', async () => {
    /* Four collapsed steps are four requests not made. The diary is read when
       the owner says they want to change the hour, not on open. */
    await open({ booking: BOOKING });

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(false);
  });

  describe('and then changing the hour', () => {
    const reopenTheHour = async () => {
      await open({ booking: BOOKING });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Change · Date and time' }));
      });
      await settle();

      return requested.find(url => url.includes('/api/scheduling/free-slots'));
    };

    it('asks the diary to ignore this booking, so its own hour is offered back', async () => {
      /*
       * The regression this test exists for. The grid reads the same diary the
       * appointment is already in, so without `exclude_booking_id` the owner
       * opening a booking at 10:00 is told 10:00 is taken — by itself — and
       * the one hour they came to keep is the one hour not on offer.
       */
      expect(await reopenTheHour()).toContain('exclude_booking_id=bk-1');
    });

    it('and opens on the appointment\'s own week rather than on today', async () => {
      /* November, from an October dialog: a strip starting today would not
         contain the hour being changed. The instant is sent, not a day — which
         day it falls on is the business zone's business. */
      expect(await reopenTheHour()).toContain('around=2026-11-20T08%3A00%3A00.000Z');
    });
  });
});

describe('a settled booking', () => {
  const cancelled = { ...BOOKING, status: 'cancelled' } as unknown as SchedulingBooking;

  it('offers nothing to change', async () => {
    await open({ booking: cancelled });

    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
  });

  it('but still says what it was', async () => {
    await open({ booking: cancelled });

    expect(screen.getByText('Dana Cohen · dana@example.com')).toBeInTheDocument();
  });

  it('and asks the slot endpoint nothing at all', async () => {
    /* There is no hour to choose. A grid here would be a picker on a booking
       that cannot be repicked. */
    await open({ booking: cancelled });

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(false);
  });

  it('and offers no form to fill in', async () => {
    /*
     * Notes and the intake toggle are things you ADD to a booking. Nothing can
     * answer that step, so by the ordinary rule it would open itself on a
     * cancelled booking and invite work on something already closed.
     */
    await open({ booking: cancelled });

    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });
});

describe('picking a slot for a package', () => {
  it('asks for the hour and nothing else', async () => {
    /*
     * The service and the client came from the container, so neither is the
     * owner's to change here — a contact with only a phone number has no name
     * and no email, and offering to edit them would be offering to break the
     * thing that is already correct.
     */
    /* `prefilledServiceId` as the real caller passes it — the service comes
       from the package container, which is the point. */
    await open({ onPickSlot: jest.fn(), prefilledServiceId: 'svc-1' });

    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
  });

  it('opens the hour when nothing has answered it', async () => {
    /*
     * No series date handed in, so the hour is genuinely unanswered and the
     * ordinary rule opens it — a question with no answer stays open.
     */
    await open({
      onPickSlot: jest.fn(),
      prefilledServiceId: 'svc-1',
      prefilledContact: { id: 'c-1', firstName: 'Dana', email: 'dana@example.com' },
    });
    await settle();

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(true);
  });

  it('but leaves it COLLAPSED when the series already named one', async () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * The hour step used to be forced open for `onPickSlot`, on the reasoning
     * that the dialog "defaults a start time" — so every step read as answered
     * and the one question being asked would open collapsed.
     *
     * That default is no longer a default. The dialog opens on the hour the
     * SERIES says comes next, at the same time as the others: an answer the
     * owner usually accepts. Forcing the picker open put a week of slots in
     * front of a decision already made — and fetched them to do it.
     *
     * Collapsed, with its "change" link, like every other answered step.
     * ───────────────────────────────────────────────────────────────────────
     */
    await open({
      onPickSlot: jest.fn(),
      prefilledServiceId: 'svc-1',
      prefilledContact: { id: 'c-1', firstName: 'Dana', email: 'dana@example.com' },
      prefilledStartLocal: '2026-12-02T10:00',
    });
    await settle();

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(false);
  });
});

describe('a recurring package, whose dates the caller named', () => {
  it('still offers the series\' own dates, not only the grid\'s suggestions', async () => {
    /*
     * `seriesSlots` is a SCHEDULE, not a suggestion: the drawer hands in the
     * package's remaining dates, and nothing the slot endpoint knows could
     * work them out. Hiding them behind "another time" would have lost the one
     * set of dates that is not the dialog's own idea.
     */
    /*
     * No `prefilledStartLocal`: the hour is unanswered, so the step opens and
     * the chips inside it are rendered. The drawer no longer hands these in —
     * the dialog opens on the series date instead — but the capability stays
     * for a caller holding dates the slot endpoint cannot know.
     */
    await open({
      onPickSlot: jest.fn(),
      prefilledServiceId: 'svc-1',
      prefilledContact: { id: 'c-1', firstName: 'Dana', email: 'dana@example.com' },
      seriesSlots: ['2026-11-20T10:00', '2026-11-27T10:00'],
      availability: {
        monday: { enabled: true, start: '09:00', end: '17:00' },
        tuesday: { enabled: true, start: '09:00', end: '17:00' },
        wednesday: { enabled: true, start: '09:00', end: '17:00' },
        thursday: { enabled: true, start: '09:00', end: '17:00' },
        friday: { enabled: true, start: '09:00', end: '17:00' },
        saturday: { enabled: false, start: '09:00', end: '17:00' },
        sunday: { enabled: true, start: '09:00', end: '17:00' },
      },
    });

    expect(screen.getByText('scheduling.booking.quick_pick')).toBeInTheDocument();
  });
});

describe('a service bought rather than booked', () => {
  it('has no date step to answer', async () => {
    /*
     * An ADHD course. The dialog used to ask for a date anyway and refuse to
     * save without one — a required field for a fact that does not exist.
     */
    await open({ prefilledServiceId: 'svc-course' });

    expect(screen.queryByText('Date and time')).not.toBeInTheDocument();
    expect(screen.queryByText('Exact time')).not.toBeInTheDocument();
  });

  it('and asks the slot endpoint nothing', async () => {
    await open({ prefilledServiceId: 'svc-course' });

    expect(requested.some(url => url.includes('/api/scheduling/free-slots'))).toBe(false);
  });
});
