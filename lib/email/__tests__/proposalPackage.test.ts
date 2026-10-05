/**
 * The quote email, when the quote sells a block of meetings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What the client actually received: six rows reading "Meeting 1 … ₪83.33" and
 * no dates anywhere, under a line saying ₪83.33 was due on approval — beside
 * terms promising nothing was due until a session had been held.
 *
 * So a client could see what each session cost, could not see when any of them
 * was, and was told to pay for one that had not happened. The dates are the
 * part they have to check against their own diary before they can answer at
 * all.
 *
 * This renders the real template, because the faults were in what it printed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateProposalEmail } from '../templates/proposal';
import type { BrandingData } from '../templates/base-template';

const branding = {
  businessName: 'Parenting School',
  primaryColor: '#0F9B8E',
  logoUrl: null,
  locale: 'en',
} as unknown as BrandingData;

/** Six weekly meetings at 16:30 Jerusalem, straddling the clocks changing. */
const DATES = [
  '2026-10-08T13:30:00.000Z',
  '2026-10-15T13:30:00.000Z',
  '2026-10-22T13:30:00.000Z',
  '2026-10-29T14:30:00.000Z',
  '2026-11-05T14:30:00.000Z',
  '2026-11-12T14:30:00.000Z',
];

const STAGES = [
  { label: 'Meeting 1', amount: 83.33 },
  { label: 'Meeting 2', amount: 83.33 },
  { label: 'Meeting 3', amount: 83.33 },
  { label: 'Meeting 4', amount: 83.33 },
  { label: 'Meeting 5', amount: 83.33 },
  { label: 'Meeting 6', amount: 83.35 },
];

const base = {
  title: 'Six coaching sessions',
  total: 500,
  currency: 'ILS',
  viewUrl: 'https://example.test/proposal/token',
  clientFirstName: 'David',
  branding,
  locale: 'en' as const,
  termsDays: 0,
};

const perSession = {
  ...base,
  stages: STAGES,
  dueOnAccept: null,
  sessions: {
    dates: DATES,
    durationMinutes: 60,
    billPerSession: true,
    timezone: 'Asia/Jerusalem',
  },
};

describe('a package billed after each meeting', () => {
  it('lists every date', () => {
    const { html } = generateProposalEmail(perSession);

    /*
     * The business's clock: half past four on every one of them, including the
     * two after the clocks change — 13:30Z becomes 14:30Z and the wall time
     * holds. Rendered in the server's zone they would all read 09:30 in New
     * York, which is what the client was sent.
     *
     * Matched on the locale's own formatting rather than a 24-hour string:
     * `en-US` prints "October 8 at 04:30 PM", and asserting the shape this
     * template really produces is the point of rendering it.
     */
    expect(html).toContain('October 8 at 04:30 PM');
    expect(html).toContain('October 29 at 04:30 PM');
    expect(html).toContain('November 12 at 04:30 PM');
  });

  it('says which clock those hours are on', () => {
    const { html } = generateProposalEmail(perSession);
    expect(html).toContain('Asia/Jerusalem');
  });

  it('puts each amount on its own meeting', () => {
    const { html } = generateProposalEmail(perSession);

    expect(html).toContain('₪83.33');
    expect(html).toContain('₪83.35');
  });

  it('does not list the stages again under their own heading', () => {
    const { html } = generateProposalEmail(perSession);

    // The stages ARE the meetings: two lists would be the same six facts in two
    // different orders, which is what made this email hard to read.
    const headings = html.split('How it is paid').length - 1;
    expect(headings).toBe(0);
  });

  it('says nothing is due now', () => {
    const { html } = generateProposalEmail(perSession);

    expect(html).toContain('Each meeting is invoiced after it has taken place');
    expect(html).not.toContain('due on approval');
  });
});

describe('a package paid up front', () => {
  const upfront = {
    ...base,
    stages: [],
    dueOnAccept: 500,
    sessions: {
      dates: DATES,
      durationMinutes: 60,
      billPerSession: false,
      timezone: 'Asia/Jerusalem',
    },
  };

  it('still lists the dates', () => {
    const { html } = generateProposalEmail(upfront);
    expect(html).toContain('October 8 at 04:30 PM');
  });

  it('does not promise that each meeting is billed separately', () => {
    const { html } = generateProposalEmail(upfront);
    expect(html).not.toContain('Each meeting is invoiced after it has taken place');
  });
});

describe('an ordinary staged quote', () => {
  it('keeps its stage list exactly as before', () => {
    const { html } = generateProposalEmail({
      ...base,
      stages: [
        { label: 'Deposit', amount: 10000 },
        { label: 'On completion', amount: 10000 },
      ],
      dueOnAccept: 10000,
      total: 20000,
      sessions: null,
    });

    expect(html).toContain('Deposit');
    expect(html).toContain('On completion');
    // And no meetings block, because there are no meetings.
    expect(html).not.toContain('Times shown in');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * CANCELLING THE WHOLE BLOCK.
 *
 * One email, listing every date that is now off — not one cancellation per
 * meeting, which is six times the alarm for one piece of news and leaves the
 * client working out whether anything survived.
 * ─────────────────────────────────────────────────────────────────────────── */

import { generateBookingCancellationEmail } from '../templates/booking-confirmation';

describe('a cancelled package', () => {
  const cancelled = {
    clientName: 'David',
    serviceName: 'Coaching',
    dateTime: new Date(DATES[0]),
    timezone: 'Asia/Jerusalem',
    branding,
    locale: 'en' as const,
    sessions: DATES.map(iso => new Date(iso)),
  };

  it('lists every date that is off', () => {
    const { html } = generateBookingCancellationEmail(cancelled);

    /*
     * `formatEmailDate` is what this template already uses for its one date, so
     * the list is in the same words and the same zone — "Thursday, October 8,
     * 2026 at 4:30 PM Israel Daylight Time". Matched loosely on the day and the
     * hour, because the zone's own NAME changes across the clock change and the
     * point here is that every date is present.
     */
    expect(html).toContain('October 8, 2026 at 4:30 PM');
    expect(html).toContain('November 12, 2026 at 4:30 PM');
  });

  it('does not also print the single date row', () => {
    const { html } = generateBookingCancellationEmail(cancelled);

    // The list and then "Date: 8 October" above it would read as a seventh.
    const singleRow = html.split('October 8, 2026 at 4:30 PM').length - 1;
    expect(singleRow).toBe(1);
  });

  it('leaves an ordinary cancellation exactly as it was', () => {
    const { html } = generateBookingCancellationEmail({ ...cancelled, sessions: undefined });

    expect(html).toContain('October 8');
    expect(html).not.toContain('November 12');
    // And one date row, as it always had.
    expect(html.split('October 8').length - 1).toBe(1);
  });
});
