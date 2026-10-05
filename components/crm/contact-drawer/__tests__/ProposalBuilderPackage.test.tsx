/**
 * @jest-environment jsdom
 *
 * Selling a block of meetings from the quote dialog.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The first version of this panel asked the owner to type every date. For a
 * twelve-session package that is twelve pickers, which is not a feature — and in
 * Hebrew the side-by-side rows wrapped into a stack of orphaned fragments: a
 * bare "1.", a blank line, then a date.
 *
 * So the owner now describes the PATTERN — first meeting, how often, how many —
 * and the dates are generated and then editable. What the quote stores is still
 * the explicit dates, which is what these pin down:
 *
 *   · turning the switch on produces a whole series, not one empty row;
 *   · changing the pattern regenerates them;
 *   · editing ONE date keeps that edit when the count changes, because the one
 *     thing an owner does here is move the week that is a holiday;
 *   · the payload carries instants, not the wall-clock strings the inputs hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const COPY: Record<string, string> = {
  'proposal.field.payment': 'How it is paid',
  'proposal.shape.single': 'One payment',
  'proposal.shape.milestones': 'By stages',
  'proposal.shape.installments': 'In instalments',
  'proposal.package_pay_upfront': 'Up front',
  'proposal.package_pay_per_session': 'After each meeting',
  'proposal.package_pay_upfront_why': 'One invoice for the whole package when the client approves.',
  'proposal.package_pay_per_session_why': 'Nothing to pay now. Each meeting you mark as held raises its own invoice for {each}.',
  'proposal.package_session_n': 'Meeting {n}',
  'proposal.stages': 'Stages',
  'proposal.field.terms': 'Payment terms',
  'proposal.terms_default': 'Default ({days} days)',
  'invoice.payment_terms_values.due_on_receipt': 'Due on receipt',
  'invoice.payment_terms_values.net_7': '7 days',
  'invoice.payment_terms_values.net_15': '15 days',
  'invoice.payment_terms_values.net_30': '30 days',
  'invoice.payment_terms_values.net_60': '60 days',
  'proposal.terms_hint_single': 'How long the client has to pay the invoice.',
  'proposal.terms_hint_stages': 'How long the client has to pay each stage, counted from the moment you bill it.',
  'proposal.terms_hint_installments': 'How long the client has to pay each period.',
  'proposal.terms_hint_upfront': 'Until it is paid the hours stay held and the meetings are not confirmed.',
  'proposal.terms_hint_per_session': 'How long the client has to pay for each meeting that has taken place.',
  'proposal.package_date_past': 'This time has already passed.',
  'proposal.package_date_taken': 'Something is already booked at this time, so this meeting would not be created.',
  'proposal.package_date_outside': 'Outside your hours for this service ({start}-{end}).',
  'scheduling.closed': 'Closed',
  'proposal.package_dates_lost': '{count} of these meetings will not be booked.',
  'proposal.package_dates_warned': '{count} of these meetings fall on a day you are closed.',
  'proposal.package': 'Several meetings (a package)',
  'proposal.package_hint': 'Sell a block of sessions as one purchase.',
  'proposal.package_first': 'First meeting',
  'proposal.package_how_many': 'How many, and how long',
  'proposal.package_repeats': 'Repeats',
  'proposal.package_cadence_weekly': 'Weekly',
  'proposal.package_cadence_biweekly': 'Fortnightly',
  'proposal.package_cadence_monthly': 'Monthly',
  'proposal.package_minutes': 'minutes',
  'proposal.package_each_lasts': 'Each meeting lasts',
  'proposal.package_remove_date': 'Remove this meeting',
  'proposal.package_count': '{count} meetings of {minutes} minutes.',
  'proposal.package_pick_first': 'Pick the first meeting and the rest are filled in.',
  'proposal.package_needs_service': 'Pick a service for this quote first.',
  'proposal.title_label': 'Title',
  'proposal.total_label': 'Total',
  'proposal.send': 'Send',
};

const t = (key: string) => COPY[key] ?? key;

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ timezone: 'Asia/Jerusalem', language: 'en' }),
}));

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger, clientLogger: logger };
});

import { ProposalBuilderModal } from '../ProposalBuilderModal';

/** Every date input in the generated list, in order. */
const dateInputs = () =>
  Array.from(document.querySelectorAll('input[type="datetime-local"]')) as HTMLInputElement[];

/** The list, excluding the "first meeting" control at the top. */
const seriesValues = () => dateInputs().slice(1).map(input => input.value);

const fetchMock = jest.fn();

/** What the three endpoints answer, set per test. */
let answers: {
  timeOff: Array<Record<string, unknown>>;
  availability: Record<string, Array<{ start: string; end: string }>> | null;
  bookings: Array<Record<string, unknown>>;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Time off, the service's length, the business terms: all absent is fine —
  // each reader falls back, and none of them is what this file is about.
  /*
   * Three endpoints are asked, and each test says what they answer: the time
   * off, the service (its length and its weekly hours), and what is already
   * booked across the window the dates cover.
   */
  answers = { timeOff: [], availability: null, bookings: [] };

  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/time-off')) {
      return { ok: true, json: async () => ({ success: true, data: answers.timeOff }) };
    }
    if (url.includes('/scheduling/services/')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          service: { duration_minutes: 60, availability: answers.availability },
        }),
      };
    }
    if (url.includes('/scheduling/bookings')) {
      return { ok: true, json: async () => ({ success: true, bookings: answers.bookings }) };
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) };
  });

  global.fetch = fetchMock as unknown as typeof fetch;
});

async function openDialog() {
  await act(async () => {
    render(
      <ProposalBuilderModal
        isOpen
        onClose={() => {}}
        contactId="contact-1"
        contactName="Dana"
        serviceId="service-1"
        onSent={() => {}}
        t={t}
      />
    );
  });

}

async function turnPackageOn() {
  await openDialog();

  // The package switch is the first one in the panel; the document switch is
  // the other. Found by its id, which is what the label points at.
  const toggle = document.getElementById('proposal-is-package') as HTMLElement;
  await act(async () => {
    fireEvent.click(toggle);
  });
}

describe('turning it on', () => {
  it('produces a whole series rather than one empty row', async () => {
    await turnPackageOn();

    // Six weekly meetings is the default block, so the controls demonstrate
    // themselves instead of presenting an empty panel.
    expect(seriesValues()).toHaveLength(6);
  });

  it('steps a week between them, at the hour it opened on', async () => {
    await turnPackageOn();

    const values = seriesValues();
    const days = values.map(value => new Date(`${value}:00Z`).getUTCDate());

    expect(values.every(value => value.endsWith('T10:00'))).toBe(true);
    // Consecutive entries are seven days apart on the calendar.
    for (let i = 1; i < values.length; i++) {
      const previous = new Date(`${values[i - 1]}:00Z`);
      const next = new Date(`${values[i]}:00Z`);
      expect((next.getTime() - previous.getTime()) / 86_400_000).toBe(7);
    }
    expect(days).toHaveLength(6);
  });

  it('says how many and how long, in one line', async () => {
    await turnPackageOn();

    expect(screen.getByText('6 meetings of 60 minutes.')).toBeInTheDocument();
  });
});

describe('the pattern', () => {
  it('regenerates the series when the cadence changes', async () => {
    await turnPackageOn();
    const weekly = seriesValues();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    });

    const monthly = seriesValues();
    expect(monthly[0]).toBe(weekly[0]);
    // A month later, not four weeks: the dates must differ from the weekly run.
    expect(monthly[1]).not.toBe(weekly[1]);
    expect(new Date(`${monthly[1]}:00Z`).getUTCDate()).toBe(
      new Date(`${monthly[0]}:00Z`).getUTCDate()
    );
  });

  it('grows and shrinks the series with the count', async () => {
    await turnPackageOn();

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(count, { target: { value: '12' } });
    });
    expect(seriesValues()).toHaveLength(12);

    await act(async () => {
      fireEvent.change(count, { target: { value: '3' } });
    });
    expect(seriesValues()).toHaveLength(3);
  });

  it('caps at a year of weekly sessions', async () => {
    await turnPackageOn();

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(count, { target: { value: '500' } });
    });

    expect(seriesValues()).toHaveLength(52);
  });
});

describe('a date the owner moved by hand', () => {
  it('survives a change to the count', async () => {
    await turnPackageOn();

    // Move the third meeting two days later — the holiday case, which is the
    // whole reason the generated dates stay editable.
    const moved = '2026-11-05T15:30';
    await act(async () => {
      fireEvent.change(dateInputs()[3], { target: { value: moved } });
    });
    expect(seriesValues()[2]).toBe(moved);

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(count, { target: { value: '8' } });
    });

    expect(seriesValues()).toHaveLength(8);
    expect(seriesValues()[2]).toBe(moved);
  });

  it('can be removed, and the count follows', async () => {
    await turnPackageOn();

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText('Remove this meeting')[0]);
    });

    expect(seriesValues()).toHaveLength(5);
    expect((document.getElementById('proposal-session-count') as HTMLInputElement).value).toBe('5');
  });
});

describe('a quote with no service', () => {
  it('cannot be a package, and says why', async () => {
    await act(async () => {
      render(
        <ProposalBuilderModal
          isOpen
          onClose={() => {}}
          contactId="contact-1"
          contactName="Dana"
          serviceId={null}
          onSent={() => {}}
          t={t}
        />
      );
    });

    expect(document.getElementById('proposal-is-package')).toBeDisabled();
    expect(screen.getByText('Pick a service for this quote first.')).toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE MONEY QUESTION, which the package rewrites.
 *
 * `One payment / By stages / In instalments` is the right question for a JOB.
 * A block of ten meetings has no phases and no periods, so with meetings on it
 * is asked the only two things that mean anything about a block — and the
 * stages editor, which bills phases of work, is not asked at all.
 * ─────────────────────────────────────────────────────────────────────────── */

const pressed = (label: string) =>
  screen.getByRole('button', { name: label }).getAttribute('aria-pressed');

describe('the money question', () => {
  it('asks the three job answers when there are no meetings', async () => {
    await openDialog();

    expect(screen.getByRole('button', { name: 'One payment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By stages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In instalments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Up front' })).not.toBeInTheDocument();
  });

  it('asks the two package answers once there are', async () => {
    await turnPackageOn();

    expect(screen.getByRole('button', { name: 'Up front' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'After each meeting' })).toBeInTheDocument();
    // Phases and periods are not questions about a block of meetings.
    expect(screen.queryByRole('button', { name: 'By stages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In instalments' })).not.toBeInTheDocument();
  });

  it('opens on up front, and says what that means', async () => {
    await turnPackageOn();

    expect(pressed('Up front')).toBe('true');
    expect(
      screen.getByText('One invoice for the whole package when the client approves.')
    ).toBeInTheDocument();
  });

  it('states what one meeting costs when billed after each', async () => {
    await turnPackageOn();

    // The price of the BLOCK is what the owner types; this is derived, so the
    // two can never disagree.
    const total = document.getElementById('proposal-total') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(total, { target: { value: '5000' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'After each meeting' }));
    });

    expect(pressed('After each meeting')).toBe('true');
    // 5,000 over six meetings. The currency formatting is the dialog's own.
    expect(screen.getByText(/Nothing to pay now\./)).toBeInTheDocument();
    expect(screen.getByText(/833/)).toBeInTheDocument();
  });

  it('never shows the stages editor for a package', async () => {
    await turnPackageOn();
    expect(screen.queryByText('Stages')).not.toBeInTheDocument();
  });

  it('gives the three job answers back when the package is turned off', async () => {
    await turnPackageOn();

    const toggle = document.getElementById('proposal-is-package') as HTMLElement;
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getByRole('button', { name: 'By stages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Up front' })).not.toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE PAYMENT TERMS, which govern every arrangement and not just one invoice.
 *
 * They were asked ABOVE the shape, where they were a deadline for an invoice
 * nobody had described yet. They now sit after it and say what they do — and
 * "up front" pulls them to due-on-receipt, because a package paid up front with
 * 30-day terms leaves the hours held and the meetings unconfirmed for a month.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the payment terms', () => {
  it('say what they govern for a one-off job', async () => {
    await openDialog();

    expect(screen.getByText('How long the client has to pay the invoice.')).toBeInTheDocument();
  });

  it('say what they govern for a staged job', async () => {
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'By stages' }));
    });

    expect(
      screen.getByText('How long the client has to pay each stage, counted from the moment you bill it.')
    ).toBeInTheDocument();
  });

  it('follow "up front" to due on receipt', async () => {
    await turnPackageOn();

    // "Up front" and "pay in 30 days" are opposite instructions.
    expect(screen.getByRole('button', { name: 'Due on receipt' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByText('Until it is paid the hours stay held and the meetings are not confirmed.')
    ).toBeInTheDocument();
  });

  it('stay on due-on-receipt for per-session billing too', async () => {
    await turnPackageOn();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'After each meeting' }));
    });

    /*
     * The invoice goes out the moment a session is marked held, so a 45-day
     * business default turned "after each meeting" into "six weeks after each
     * meeting" — which is not what either side read.
     */
    expect(screen.getByRole('button', { name: 'Due on receipt' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByText('How long the client has to pay for each meeting that has taken place.')
    ).toBeInTheDocument();
  });

  it('never move again once the owner has answered them', async () => {
    await turnPackageOn();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '15 days' }));
    });

    // Switching the money answer must not overwrite a figure somebody chose.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'After each meeting' }));
    });

    expect(screen.getByRole('button', { name: '15 days' }).getAttribute('aria-pressed')).toBe('true');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A DATE THAT CANNOT BE KEPT.
 *
 * Reported: the first meeting was put on a blocked slot and nothing said so.
 * Three things make a date unkeepable, and acceptance SKIPS the ones it cannot
 * take — so a silent warning here becomes a meeting that is quietly not there.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The first generated date, as the series opens on it: a week today at 10:00. */
const firstKey = () => (dateInputs()[1]?.value ?? '').slice(0, 10);

describe('a date on a day the owner closed', () => {
  it('is named, with their own reason', async () => {
    /*
     * Set BEFORE the dialog opens: the time off and the service are read once
     * on mount, so answering them later is answering nobody.
     */
    answers.timeOff = [
      {
        exception_type: 'unavailable',
        start_date: '2020-01-01',
        end_date: '2099-12-31',
        reason: 'Sabbatical',
      },
    ];

    await turnPackageOn();

    expect(screen.getAllByText('Closed · Sabbatical').length).toBeGreaterThan(0);
  });
});

describe('a date outside the service hours', () => {
  it('names the hours that ARE open', async () => {
    // Open 13:00-17:00 every day; the series opens at 10:00.
    const window = [{ start: '13:00', end: '17:00' }];
    answers.availability = {
      sunday: window,
      monday: window,
      tuesday: window,
      wednesday: window,
      thursday: window,
      friday: window,
      saturday: window,
    };

    await turnPackageOn();

    expect(
      screen.getAllByText('Outside your hours for this service (13:00-17:00).').length
    ).toBe(6);
  });

  it('says nothing when the hour is inside them', async () => {
    const window = [{ start: '09:00', end: '18:00' }];
    answers.availability = {
      sunday: window,
      monday: window,
      tuesday: window,
      wednesday: window,
      thursday: window,
      friday: window,
      saturday: window,
    };

    await turnPackageOn();

    expect(screen.queryByText(/Outside your hours/)).not.toBeInTheDocument();
  });
});

describe('a date whose hour is already sold', () => {
  it('says the meeting would not be created', async () => {
    await turnPackageOn();

    // Now something lands on the first meeting's hour, and the series is
    // re-checked against it.
    const first = firstKey();
    answers.bookings = [
      {
        id: 'other',
        status: 'confirmed',
        start_time: new Date(`${first}T07:30:00.000Z`).toISOString(),
        end_time: new Date(`${first}T08:30:00.000Z`).toISOString(),
      },
    ];

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(count, { target: { value: '7' } });
    });

    expect(
      screen.getAllByText(
        'Something is already booked at this time, so this meeting would not be created.'
      ).length
    ).toBeGreaterThan(0);
  });

  it('ignores a cancelled booking, which holds no hour', async () => {
    await turnPackageOn();

    const first = firstKey();
    answers.bookings = [
      {
        id: 'other',
        status: 'cancelled',
        start_time: new Date(`${first}T07:30:00.000Z`).toISOString(),
        end_time: new Date(`${first}T08:30:00.000Z`).toISOString(),
      },
    ];

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(count, { target: { value: '7' } });
    });

    expect(screen.queryByText(/already booked/)).not.toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * HOW LOUD THE WARNING IS.
 *
 * One 11px amber line under every kind of problem read as "note" where half of
 * them mean "there will be no meeting". Red now means exactly that — a date in
 * the past, or an hour already sold, which acceptance SKIPS — and amber means
 * it will be booked anyway, on a closed day or outside the hours. A headline
 * above the list says how many, so twelve dates need not be scanned.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the headline above the dates', () => {
  it('says how many will not be booked, when any are lost', async () => {
    await turnPackageOn();

    const first = firstKey();
    answers.bookings = [
      {
        id: 'other',
        status: 'confirmed',
        start_time: new Date(`${first}T07:30:00.000Z`).toISOString(),
        end_time: new Date(`${first}T08:30:00.000Z`).toISOString(),
      },
    ];

    const count = document.getElementById('proposal-session-count') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(count, { target: { value: '7' } });
    });

    expect(screen.getByText('1 of these meetings will not be booked.')).toBeInTheDocument();
  });

  it('says how many are merely warned about, when none are lost', async () => {
    answers.timeOff = [
      {
        exception_type: 'unavailable',
        start_date: '2020-01-01',
        end_date: '2099-12-31',
        reason: 'Sabbatical',
      },
    ];

    await turnPackageOn();

    // Six closed days, and not one of them lost: a closed day is still booked.
    expect(
      screen.getByText('6 of these meetings fall on a day you are closed.')
    ).toBeInTheDocument();
  });

  it('is absent when every date is keepable', async () => {
    await turnPackageOn();

    expect(screen.queryByText(/will not be booked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fall on a day/)).not.toBeInTheDocument();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * REVISING A DECLINED PACKAGE.
 *
 * Reported: a revision of "six sessions, billed after each" opened as a
 * six-STAGE job. A per-session package IS a milestone plan underneath, so
 * inheriting the payment shape alone turned its meetings into phases of work
 * called "Meeting 1"…"Meeting 6" and lost the dates entirely — the owner
 * re-quoted a block of sessions as something else.
 * ─────────────────────────────────────────────────────────────────────────── */

const DECLINED_PACKAGE = {
  title: 'Six coaching sessions',
  description: 'As discussed',
  total: 500,
  status: 'declined',
  payment_terms_days: 15,
  // What a per-session package really is underneath.
  payment_shape: {
    kind: 'milestones' as const,
    stages: Array.from({ length: 6 }, (_, i) => ({ label: `Meeting ${i + 1}`, percent: 16.6667 })),
  },
  sessions: {
    dates: [
      '2099-10-08T13:30:00.000Z',
      '2099-10-15T13:30:00.000Z',
      '2099-10-22T13:30:00.000Z',
      '2099-10-29T13:30:00.000Z',
      '2099-11-05T14:30:00.000Z',
      '2099-11-12T14:30:00.000Z',
    ],
    duration_minutes: 50,
    bill_per_session: true,
  },
};

async function openRevision(basedOn: Record<string, unknown> = DECLINED_PACKAGE) {
  await act(async () => {
    render(
      <ProposalBuilderModal
        isOpen
        onClose={() => {}}
        contactId="contact-1"
        contactName="Dana"
        serviceId="service-1"
        supersedesId="prop-1"
        basedOn={basedOn as never}
        onSent={() => {}}
        t={t}
      />
    );
  });
}

describe('a revision of a package', () => {
  it('opens as a package, with its dates', async () => {
    await openRevision();

    expect(document.getElementById('proposal-is-package')).toBeChecked();
    // Six dates back, plus the first-meeting control.
    expect(dateInputs()).toHaveLength(7);
    expect(seriesValues()).toHaveLength(6);
  });

  it('keeps how it was billed', async () => {
    await openRevision();

    expect(pressed('After each meeting')).toBe('true');
    expect(screen.queryByRole('button', { name: 'By stages' })).not.toBeInTheDocument();
  });

  it('never shows its meetings as stages of work', async () => {
    await openRevision();

    // The bug: "Meeting 1" as a stage label in the stages editor.
    expect(screen.queryByText('Stages')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Meeting 1')).not.toBeInTheDocument();
  });

  it('keeps the length each meeting was sold at', async () => {
    await openRevision();

    expect((document.getElementById('proposal-session-minutes') as HTMLInputElement).value).toBe('50');
  });

  it('keeps the terms that were negotiated', async () => {
    await openRevision();

    // 15 days was agreed with this client; the package default must not pull it
    // back to due-on-receipt behind the owner's back.
    expect(screen.getByRole('button', { name: '15 days' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a revision of an ordinary staged job', () => {
  it('still opens on its stages', async () => {
    await openRevision({
      title: 'Kitchen',
      description: null,
      total: 20000,
      status: 'declined',
      payment_terms_days: null,
      payment_shape: {
        kind: 'milestones',
        stages: [
          { label: 'Deposit', percent: 50 },
          { label: 'On completion', percent: 50 },
        ],
      },
      sessions: null,
    });

    expect(document.getElementById('proposal-is-package')).not.toBeChecked();
    expect(screen.getByDisplayValue('Deposit')).toBeInTheDocument();
  });
});
