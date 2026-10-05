/**
 * The briefing stale-date guard (P1; SA ruling OP-1 / W7C-2).
 *
 * The claim RPC has no date predicate, so a row left pending past the
 * business's midnight used to be rendered with the NEXT day's content under the
 * old date, and that day's own row then sent too: two "today" briefings. The
 * guard closes such a row `skipped / stale_date` before any facts, AI or email.
 *
 * This is the first suite that drives `processDueBriefings` itself rather than
 * mocking it. The business-day arithmetic is the REAL module (wrapped only to
 * count calls and capture the returned object), because the zone boundaries
 * are the thing under test. `briefing_date` is fed as 'YYYY-MM-DD', the shape
 * PostgREST returns for a `date` column.
 *
 * Dates are in July 2025, far from the real clock, so a mutation that renders
 * with `new Date()` cannot pass by coincidence. In July: Asia/Jerusalem is
 * UTC+3, America/Los_Angeles UTC-7, Asia/Kolkata UTC+5:30.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/* ------------------------------------------------------------------ logger */

const warnings: Array<{ ctx: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: (ctx: Record<string, unknown>, msg: string) => warnings.push({ ctx, msg }),
  }),
}));

/* -------------------------------------------------------- the real business day */

jest.mock('@/lib/business-os/businessDay', () => {
  const actual = jest.requireActual('@/lib/business-os/businessDay');
  return { ...actual, businessDayFor: jest.fn(actual.businessDayFor) };
});
import { businessDayFor, type BusinessDay } from '@/lib/business-os/businessDay';
const businessDayForMock = businessDayFor as jest.MockedFunction<typeof businessDayFor>;

/* ------------------------------------------------------------- supabaseServer */

/** What `user_preferences` holds now — deliberately able to differ from a row's zone. */
const preferencesState: { timezone: string | null } = { timezone: null };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const chain: Record<string, unknown> = {
        // The enqueue's list reads. No opted-in businesses, so the enqueue is
        // inert and every row under test comes from the claim.
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
        maybeSingle: async () => ({
          data:
            table === 'business_profiles'
              ? { language: 'en', company_name: 'Test Co', vertical: null, sub_vertical: null }
              : { preferred_language: 'en', timezone: preferencesState.timezone },
          error: null,
        }),
      };
      for (const m of ['select', 'eq', 'in']) chain[m] = () => chain;
      return chain;
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: 'owner@example.com', user_metadata: { full_name: 'Dana Owner' } } },
          error: null,
        }),
      },
    },
  },
}));

/* ------------------------------------------------------------- the queue repo */

interface Row {
  id: string;
  user_id: string;
  briefing_date: string;
  timezone: string;
  status: 'processing';
  attempts: number;
  error_message: null;
  skip_reason: null;
  sent_at: null;
}

const claimState: { rows: Row[] } = { rows: [] };
const skipResult: { error: Error | null } = { error: null };

const repo = {
  reapStale: jest.fn(async () => ({ data: [], error: null })),
  enqueue: jest.fn(async () => ({ data: true, error: null })),
  claimDue: jest.fn(async () => ({ data: claimState.rows, error: null })),
  markSent: jest.fn(async () => ({ data: true, error: null })),
  markSkipped: jest.fn(async () =>
    skipResult.error ? { data: null, error: skipResult.error } : { data: true, error: null }
  ),
  markFailed: jest.fn(async () => ({ data: true, error: null })),
};
jest.mock('@/lib/repositories/DailyBriefingSendRepository', () => ({
  dailyBriefingSendRepository: repo,
}));

/* ------------------------------------------------ facts, AI, branding, email */

const buildBriefingFacts = jest.fn<Promise<{ isQuiet: boolean }>, unknown[]>(async () => ({ isQuiet: false }));
jest.mock('@/lib/business-os/briefing/BriefingFactsService', () => ({
  buildBriefingFacts: (...args: unknown[]) => buildBriefingFacts(...args),
}));

const getBriefing = jest.fn<Promise<{ narrative: string }>, unknown[]>(async () => ({ narrative: 'Two bookings today.' }));
jest.mock('@/lib/business-os/briefing/BriefingStore', () => ({
  getBriefing: (...args: unknown[]) => getBriefing(...args),
}));

jest.mock('@/lib/business-os/briefing/BriefingNarrator', () => ({
  briefingLines: (narrative: string) => (narrative ? [narrative] : []),
}));

const resolveEmailBranding = jest.fn<Promise<{ businessName: string }>, unknown[]>(async () => ({ businessName: 'Test Co' }));
jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: (...args: unknown[]) => resolveEmailBranding(...args),
}));

const generateDailyBriefingEmail = jest.fn<{ subject: string; html: string }, unknown[]>(() => ({ subject: 's', html: '<p/>' }));
jest.mock('@/lib/email/templates/daily-briefing', () => ({
  generateDailyBriefingEmail: (...args: unknown[]) => generateDailyBriefingEmail(...args),
}));

const sendEmail = jest.fn<Promise<{ sent: boolean; provider: string }>, unknown[]>(async () => ({ sent: true, provider: 'resend' }));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { processDueBriefings } from '@/lib/services/DailyBriefingDispatchService';

/* ------------------------------------------------------------------- helpers */

function row(id: string, briefingDate: string, timezone: string): Row {
  return {
    id,
    user_id: `user-${id}`,
    briefing_date: briefingDate,
    timezone,
    status: 'processing',
    attempts: 1,
    error_message: null,
    skip_reason: null,
    sent_at: null,
  };
}

function expectNothingBuiltOrSent(): void {
  expect(buildBriefingFacts).not.toHaveBeenCalled();
  expect(getBriefing).not.toHaveBeenCalled();
  expect(resolveEmailBranding).not.toHaveBeenCalled();
  expect(generateDailyBriefingEmail).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
  expect(repo.markSent).not.toHaveBeenCalled();
}

function expectSentFor(date: string): void {
  expect(buildBriefingFacts).toHaveBeenCalledTimes(1);
  expect((buildBriefingFacts.mock.calls[0][1] as BusinessDay).date).toBe(date);
  expect(generateDailyBriefingEmail).toHaveBeenCalledTimes(1);
  expect((generateDailyBriefingEmail.mock.calls[0][0] as { date: string }).date).toBe(date);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(repo.markSkipped).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  warnings.length = 0;
  claimState.rows = [];
  skipResult.error = null;
  preferencesState.timezone = null;
});

/* --------------------------------------------------------------------- tests */

describe('processDueBriefings — the stale-date guard', () => {
  it('T-1 sends a same-day row unchanged, rendering the very day it checked', async () => {
    claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];

    // 07:10 local in Jerusalem.
    const summary = await processDueBriefings(new Date('2025-07-15T04:10:00Z'));

    expect(summary).toEqual({ enqueued: 0, sent: 1, skipped: 0, failed: 0 });
    expectSentFor('2025-07-15');
    expect(repo.markSent).toHaveBeenCalledWith('a');

    // One day per row, and the facts receive THAT object — not a recomputation.
    expect(businessDayForMock).toHaveBeenCalledTimes(1);
    expect(businessDayForMock).toHaveBeenCalledWith(expect.any(Date), 'Asia/Jerusalem');
    expect(buildBriefingFacts.mock.calls[0][1]).toBe(businessDayForMock.mock.results[0].value);
    expect(warnings).toHaveLength(0);
  });

  it("T-2 skips a row left pending past the business's midnight: no facts, no AI, no email", async () => {
    claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];

    // 00:10 on the 16th in Jerusalem — the first run after a cron outage.
    const summary = await processDueBriefings(new Date('2025-07-15T21:10:00Z'));

    expect(summary).toEqual({ enqueued: 0, sent: 0, skipped: 1, failed: 0 });
    expect(repo.markSkipped).toHaveBeenCalledTimes(1);
    expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
    expectNothingBuiltOrSent();
  });

  describe('T-3..T-5 zone boundaries (the row’s own zone, not UTC)', () => {
    it('Asia/Jerusalem 23:59:59.999 local still sends', async () => {
      claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];
      await processDueBriefings(new Date('2025-07-15T20:59:59.999Z'));
      expectSentFor('2025-07-15');
    });

    it('Asia/Jerusalem 00:00 local skips, while the UTC date is still the row date', async () => {
      claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];
      // 21:00Z on the 15th is 00:00 on the 16th in Jerusalem.
      await processDueBriefings(new Date('2025-07-15T21:00:00Z'));
      expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
      expectNothingBuiltOrSent();
    });

    it('America/Los_Angeles sends when the UTC date has already moved on', async () => {
      claimState.rows = [row('a', '2025-07-15', 'America/Los_Angeles')];
      // 01:10Z on the 16th is 18:10 on the 15th in Los Angeles.
      await processDueBriefings(new Date('2025-07-16T01:10:00Z'));
      expectSentFor('2025-07-15');
    });

    it('America/Los_Angeles skips after its own midnight', async () => {
      claimState.rows = [row('a', '2025-07-15', 'America/Los_Angeles')];
      // 07:10Z on the 16th is 00:10 on the 16th in Los Angeles.
      await processDueBriefings(new Date('2025-07-16T07:10:00Z'));
      expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
      expectNothingBuiltOrSent();
    });

    it('Asia/Kolkata (+05:30) sends at 23:59:59 local', async () => {
      claimState.rows = [row('a', '2025-07-15', 'Asia/Kolkata')];
      await processDueBriefings(new Date('2025-07-15T18:29:59Z'));
      expectSentFor('2025-07-15');
    });

    it('Asia/Kolkata (+05:30) skips at the half-hour midnight', async () => {
      claimState.rows = [row('a', '2025-07-15', 'Asia/Kolkata')];
      await processDueBriefings(new Date('2025-07-15T18:30:00Z'));
      expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
      expectNothingBuiltOrSent();
    });
  });

  it("T-3b uses the row's stored zone, not the current user_preferences zone", async () => {
    // The owner moved to Los Angeles after the row was written in Jerusalem.
    preferencesState.timezone = 'America/Los_Angeles';
    claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];
    // 08:00 on the 15th in Jerusalem; 22:00 on the 14th in Los Angeles.
    await processDueBriefings(new Date('2025-07-15T05:00:00Z'));
    expectSentFor('2025-07-15');
  });

  it('T-6 skips a future-dated row (fail-closed)', async () => {
    claimState.rows = [row('a', '2025-07-16', 'Asia/Jerusalem')];
    await processDueBriefings(new Date('2025-07-15T04:10:00Z'));
    expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
    expectNothingBuiltOrSent();
  });

  it('T-7 never sends a stale row when markSkipped fails', async () => {
    skipResult.error = new Error('write failed');
    claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];

    await processDueBriefings(new Date('2025-07-15T21:10:00Z'));

    expect(repo.markSkipped).toHaveBeenCalledWith('a', 'stale_date');
    expectNothingBuiltOrSent();
    // Left for the reaper: not forced to failed on the first attempt.
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('T-8 warns with ids and dates only — no address, name or content', async () => {
    claimState.rows = [row('a', '2025-07-15', 'Asia/Jerusalem')];
    await processDueBriefings(new Date('2025-07-15T21:10:00Z'));

    expect(warnings).toHaveLength(1);
    expect(Object.keys(warnings[0].ctx).sort()).toEqual(['briefingDate', 'rowId', 'runDate', 'userId']);
    expect(warnings[0].ctx).toEqual({
      rowId: 'a',
      userId: 'user-a',
      briefingDate: '2025-07-15',
      runDate: '2025-07-16',
    });
    const serialised = JSON.stringify(warnings[0]);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/Dana|Test Co|bookings/);
  });

  it('T-9 in a mixed batch skips only the stale row and sends the fresh one', async () => {
    claimState.rows = [
      row('stale', '2025-07-14', 'Asia/Jerusalem'),
      row('fresh', '2025-07-15', 'Asia/Jerusalem'),
    ];

    const summary = await processDueBriefings(new Date('2025-07-15T04:10:00Z'));

    expect(summary).toEqual({ enqueued: 0, sent: 1, skipped: 1, failed: 0 });
    expect(repo.markSkipped).toHaveBeenCalledTimes(1);
    expect(repo.markSkipped).toHaveBeenCalledWith('stale', 'stale_date');
    expect(repo.markSent).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith('fresh');
    expect(buildBriefingFacts).toHaveBeenCalledTimes(1);
    expect(buildBriefingFacts.mock.calls[0][0]).toBe('user-fresh');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('T-10 source pin: dispatchOne takes the day and never recomputes it', () => {
    const source = readFileSync(
      join(process.cwd(), 'lib/services/DailyBriefingDispatchService.ts'),
      'utf8'
    );
    const signature = source.match(/async function dispatchOne\(([^)]*)\)/);
    expect(signature?.[1].replace(/\s+/g, ' ').trim()).toBe('userId: string, day: BusinessDay');

    const body = source.slice(source.indexOf('async function dispatchOne('));
    expect(body).not.toMatch(/businessDayFor\(/);
    expect(body).not.toMatch(/new Date\(\)/);
  });
});
