/**
 * @jest-environment jsdom
 *
 * The day's timeline draws, including on a day with something in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This exists because of a crash, and the crash is worth describing: the
 * response carries a day's booked time as `HH:MM` on the business's clock
 * (`computeOpenTime` merges and clips in wall-clock minutes) and its slots as
 * ISO instants. Both are `string`.
 *
 * The timeline read the busy blocks as instants. `new Date('09:00')` is an
 * Invalid Date, `Intl.DateTimeFormat.format` throws `RangeError: Invalid time
 * value` on one, and nothing caught it — so choosing any day that had an
 * existing booking took the whole dialog down with an unhandled runtime error.
 *
 * Typing could not catch it and neither could the mockup guard, which reads
 * the source for the blocks it renders rather than rendering them. What catches
 * it is a day with a booking in it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

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

import { BookingTimeStep } from '@/components/scheduling/BookingTimeStep';

/** 10:00 and 11:00 on the business's clock, as the endpoint sends them. */
const SLOT_A = '2026-11-20T08:00:00.000Z';
const SLOT_A_END = '2026-11-20T09:00:00.000Z';
const SLOT_B = '2026-11-20T09:00:00.000Z';
const SLOT_B_END = '2026-11-20T10:00:00.000Z';

const RESPONSE = {
  success: true,
  timezone: 'Asia/Jerusalem',
  availabilityConfigured: true,
  /*
   * Sixty, and the slots above sit on the hour because of it: the timeline
   * steps its blocks by the SERVICE's own length, so a fixture whose slots do
   * not land on that grid draws a bar of "not bookable" and tests nothing.
   */
  durationMinutes: 60,
  selectedDate: '2026-11-20',
  days: [
    {
      date: '2026-11-20',
      weekday: 'friday',
      isWorkingDay: true,
      freeSlots: 2,
      freeMinutes: 360,
      bookedMinutes: 60,
      isEmpty: false,
      /* Wall clock, as `computeOpenTime` returns it. The crash lived here. */
      busy: [{ start: '13:00', end: '14:00' }],
      opensAt: '09:00',
      closesAt: '17:00',
    },
  ],
  slots: [
    { start: SLOT_A, end: SLOT_A_END, available: true, consequence: null },
    {
      start: SLOT_B,
      end: SLOT_B_END,
      available: true,
      consequence: { kind: 'closes_window' },
    },
  ],
  suggestions: [],
  nextFree: null,
};

function stub(body: unknown) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
  ) as unknown as typeof fetch;
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/**
 * The bar itself, as markup.
 *
 * Read as HTML rather than through a style selector because jsdom drops
 * `background: var(--v2-text-muted)` when it serialises inline styles — an
 * unknown value for that property — so the busy block cannot be found by its
 * colour. Its POSITION is the thing under test anyway.
 */
/**
 * The bar, as the states it draws — one block per bookable hour.
 *
 * Read by each block's `title`, which carries its legend key, rather than by
 * colour: jsdom drops `background: var(--v2-text-muted)` when it serialises
 * inline styles, so a block cannot be found by the colour it is painted.
 *
 * The bar used to be one continuous strip with percentage-positioned bars over
 * it, and these tests asserted those offsets. It is segmented now — which is
 * what the mockup draws, lines up one-to-one with the grid underneath, and
 * leaves no positioning arithmetic to get wrong.
 */
const bar = (): Element | null =>
  screen
    .getByText('scheduling.slots.selected_day')
    .closest('div')
    ?.parentElement?.querySelector('[class*="h-[26px]"]') ?? null;

const tones = (): string[] =>
  Array.from(bar()?.querySelectorAll('span') ?? []).map(
    el => el.getAttribute('title')?.replace('scheduling.slots.legend.', '') ?? '?'
  );

async function show(props: Record<string, unknown> = {}) {
  stub(RESPONSE);

  render(
    <BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} {...props} />
  );
  await settle();
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('a day with an existing booking in it', () => {
  it('renders its timeline instead of throwing', async () => {
    await show();

    expect(screen.getByText('scheduling.slots.selected_day')).toBeInTheDocument();
  });

  it('and marks the booked hour as taken, by the clock it is written in', async () => {
    /*
     * A 09:00–17:00 day with a 60-minute service draws eight blocks, 09:00
     * through 16:00. The meeting at 13:00 is the fifth.
     *
     * The day's booked time is `HH:MM` on the business's clock while the slots
     * are instants — reading one as the other did not merely mislabel a block,
     * it threw `RangeError` out of `Intl` and took the dialog with it.
     */
    await show();

    expect(tones()).toHaveLength(8);
    expect(tones()[4]).toBe('booked');
    expect(tones().filter(t => t === 'booked')).toHaveLength(1);
  });
});

describe('the chosen hour on that same timeline', () => {
  it('is marked from its instant, on the business clock', async () => {
    /*
     * The other unit. 08:00Z is 10:00 in Jerusalem — the second block of a day
     * that opens at 09:00. Read as a wall clock it would land at the wrong end
     * of the bar; read the other way round, the busy blocks threw.
     */
    await show({ value: SLOT_A });

    expect(tones()[1]).toBe('pick');
    expect(tones().filter(t => t === 'pick')).toHaveLength(1);
  });

  it('and an unreadable one marks nothing rather than taking the dialog down', async () => {
    /* No block matches, and no `RangeError` either. */
    await show({ value: 'not-an-instant' });

    expect(screen.getByText('scheduling.slots.selected_day')).toBeInTheDocument();
    expect(tones()).not.toContain('pick');
  });
});

describe('the strip, and the day the grid is showing', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The response used to carry only the SELECTED day's hours, so clicking any
   * other day in the strip emptied the grid: "no free hours this week" beside a
   * strip saying that very day had eight. It now carries the whole window, and
   * the grid filters it on the BUSINESS's calendar — a UTC prefix match drops
   * every evening hour east of Greenwich into the following day.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const WEEK = {
    ...RESPONSE,
    days: [
      RESPONSE.days[0],
      {
        date: '2026-11-21',
        weekday: 'saturday',
        isWorkingDay: true,
        freeSlots: 1,
        freeMinutes: 60,
        bookedMinutes: 0,
        isEmpty: true,
        busy: [],
        opensAt: '09:00',
        closesAt: '17:00',
      },
    ],
    slots: [
      ...RESPONSE.slots,
      /* 21:00 in Jerusalem on the 21st, which is 19:00 UTC — the same date
         here, so the day AFTER is the one a UTC slice would have claimed for
         an hour past 22:00. Kept simple: an afternoon hour on day two. */
      {
        start: '2026-11-21T12:00:00.000Z',
        end: '2026-11-21T12:50:00.000Z',
        available: true,
        consequence: null,
      },
    ],
  };

  const showWeek = async () => {
    stub(WEEK);
    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} />);
    await settle();
  };

  it('shows only the selected day, not the whole window', async () => {
    await showWeek();

    /* Two hours on the 20th; the 21st's is not in this grid. */
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('11:00')).toBeInTheDocument();
    expect(screen.queryByText('14:00')).not.toBeInTheDocument();
  });

  it('and switches to another day without a fetch', async () => {
    await showWeek();

    const calls = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByText('21').closest('button') as HTMLElement);
    });

    expect(screen.getByText('14:00')).toBeInTheDocument();
    expect(screen.queryByText('10:00')).not.toBeInTheDocument();
    /* The window is already in hand; refetching would re-rank the suggestions
       under the owner's cursor. */
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(calls);
  });

  it('a day with nothing booked still says how much of it is left', async () => {
    /*
     * "Free day" used to WIN over the count, so a day with nothing booked gave
     * no number at all while the day beside it said "8 free" — and comparing
     * two days is the only thing a strip of days is for.
     */
    await showWeek();

    const dayTwo = screen.getByText('21').closest('button') as HTMLElement;

    expect(within(dayTwo).getByText(/scheduling\.slots\.day\.free/)).toBeInTheDocument();
  });
});

describe('what is filled in the accent', () => {
  const TWO = {
    ...RESPONSE,
    suggestions: [
      { start: SLOT_A, end: SLOT_A_END, reason: 'closes_window', consequence: null },
      { start: SLOT_B, end: SLOT_B_END, reason: 'soonest', consequence: null },
    ],
  };

  const rowFor = (reason: string) =>
    screen.getByText(`scheduling.slots.reason.${reason}`).closest('button') as HTMLElement;

  it('is the recommendation, while nothing has been picked', async () => {
    /*
     * The mockup washes the first row, and that is how it reads as the
     * recommendation. It can do that safely because the mockup never draws a
     * CHOSEN row — which is exactly the trap: copied literally, the wash sat
     * beside a selection and the panel showed two at once.
     *
     * So the lead is washed only while nothing is chosen. The test below is
     * the other half.
     */
    stub(TWO);
    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} />);
    await settle();

    expect(rowFor('closes_window').getAttribute('style')).toContain('rgba(20, 184, 166');
    expect(rowFor('soonest').getAttribute('style')).not.toContain('rgba(20, 184, 166');
  });

  it('and once an hour is chosen, only its row', async () => {
    stub(TWO);
    render(<BookingTimeStep serviceId="svc-1" value={SLOT_B} onChange={jest.fn()} />);
    await settle();

    expect(rowFor('soonest').getAttribute('style')).toContain('rgba(20, 184, 166');
    expect(rowFor('closes_window').getAttribute('style')).not.toContain('rgba(20, 184, 166');
  });

  it('while the recommendation still reads as the recommendation', async () => {
    /* Said in type rather than in fill: its hour is set in the accent. */
    stub(TWO);
    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} />);
    await settle();

    const lead = within(rowFor('closes_window')).getByText(/10:00/);

    expect(lead.getAttribute('style')).toContain('rgb(20, 184, 166)');
  });
});

describe('the timeline reads the way the interface does', () => {
  it('is not pinned to left-to-right', async () => {
    /*
     * The bar and its axis carried `dir="ltr"` while the dialog around them
     * reads right-to-left, so the day ran backwards against everything beside
     * it. `insetInlineStart` already measures from the reading edge, so
     * inheriting the page direction is the whole fix — and it needs no branch
     * on the language.
     */
    await show();

    expect(bar()?.getAttribute('dir')).toBeNull();
  });

  it('while each clock string stays a number', async () => {
    /* "09:00" is read left-to-right in Hebrew too. */
    await show();

    expect(screen.getByText('09:00').getAttribute('dir')).toBe('ltr');
  });
});

describe('pressing a suggestion', () => {
  const WITH_SUGGESTION = {
    ...RESPONSE,
    suggestions: [
      { start: SLOT_B, end: SLOT_B_END, reason: 'soonest', consequence: null },
    ],
  };

  it('chooses that hour', async () => {
    const onChange = jest.fn();
    stub(WITH_SUGGESTION);
    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={onChange} />);
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByText('scheduling.slots.reason.soonest').closest('button') as HTMLElement);
    });

    expect(onChange).toHaveBeenCalledWith(SLOT_B);
  });

  it('and then looks chosen, rather than like a dead button', async () => {
    /*
     * The only sign used to be a highlighted hour down in the grid, which is
     * usually below the fold — so the owner pressed it again, and reported it
     * could not be selected.
     */
    stub(WITH_SUGGESTION);
    render(<BookingTimeStep serviceId="svc-1" value={SLOT_B} onChange={jest.fn()} />);
    await settle();

    expect(
      screen.getByText('scheduling.slots.reason.soonest').closest('button')
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('while the others do not', async () => {
    stub(WITH_SUGGESTION);
    render(<BookingTimeStep serviceId="svc-1" value={SLOT_A} onChange={jest.fn()} />);
    await settle();

    expect(
      screen.getByText('scheduling.slots.reason.soonest').closest('button')
    ).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('a business west of Greenwich, where the two calendars part company', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * 19:00 in New York is 00:00 UTC the NEXT day. A grid filtered by UTC prefix
   * drops every evening hour off its own day and files it under tomorrow, so
   * the owner loses their evenings and finds them on a day they cannot work.
   *
   * Invisible in Jerusalem, where a same-day window never crosses midnight UTC,
   * which is why the first version of this filter looked correct.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const NY = {
    ...RESPONSE,
    timezone: 'America/New_York',
    selectedDate: '2026-11-20',
    days: [{ ...RESPONSE.days[0], busy: [], opensAt: '09:00', closesAt: '21:00', freeSlots: 2 }],
    slots: [
      /* 10:00 in New York. */
      { start: '2026-11-20T15:00:00.000Z', end: '2026-11-20T15:50:00.000Z', available: true, consequence: null },
      /* 19:00 in New York, which is 2026-11-21 in UTC. */
      { start: '2026-11-21T00:00:00.000Z', end: '2026-11-21T00:50:00.000Z', available: true, consequence: null },
    ],
  };

  it('keeps the evening on the day it belongs to', async () => {
    stub(NY);
    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} />);
    await settle();

    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('19:00')).toBeInTheDocument();
  });
});

describe('a day the business is closed', () => {
  it('draws no timeline at all', async () => {
    stub({
      ...RESPONSE,
      days: [{ ...RESPONSE.days[0], isWorkingDay: false, opensAt: null, closesAt: null }],
    });

    render(<BookingTimeStep serviceId="svc-1" value={null} onChange={jest.fn()} />);
    await settle();

    expect(screen.queryByText('scheduling.slots.selected_day')).not.toBeInTheDocument();
  });
});
