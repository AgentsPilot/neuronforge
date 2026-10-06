/**
 * The settlement gap check, against a Stripe that never existed.
 *
 * Four of these are the reason the check is trustworthy rather than merely
 * present:
 *
 *   - the RETRY GRACE, or it reports every payment made in the last minute and
 *     is ignored within a week;
 *   - the CREATION LOOKBACK, or it misses exactly the case it was built for,
 *     because a plan instalment's invoice is created at booking and paid weeks
 *     later;
 *   - ABSENT IS AN ANSWER, or a Stripe payment with no local invoice at all
 *     arrives indistinguishable from a database failure;
 *   - A REFUSAL IS NOT A CLEAN BILL, or the one run that could not look
 *     anywhere reports nothing wrong.
 */

import type { Logger } from 'pino';

import {
  GAP_CHECK_LIMITS,
  runSettlementGapCheck,
  settlementWindow,
  type LocalSettlement,
  type PaidInvoiceFact,
  type SettlementGapCheckDeps,
} from '../settlementGapCheck';

const NOW = new Date('2026-10-05T12:00:00.000Z');
/** With NOW above: ends 11:00 (one hour of grace), starts 48 hours before that. */
const WINDOW = settlementWindow(NOW);

// A pino logger with only the four methods this module calls. `any` because the
// real Logger has dozens of members and a partial stub cannot satisfy it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubLogger(): { logger: Logger; errors: any[][]; warns: any[][] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors: any[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warns: any[][] = [];
  const logger = {
    info: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn: (...args: any[]) => { warns.push(args); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: (...args: any[]) => { errors.push(args); },
  } as unknown as Logger;
  return { logger, errors, warns };
}

function paid(stripeInvoiceId: string, paidAt: string | null, amountPaidMinor = 40000): PaidInvoiceFact {
  return { stripeInvoiceId, paidAt, amountPaidMinor, currency: 'ils' };
}

const SETTLED: LocalSettlement = { found: true, settled: true, invoiceId: 'local-1', status: 'paid' };
const UNSETTLED: LocalSettlement = { found: true, settled: false, invoiceId: 'local-1', status: 'sent' };
const MISSING: LocalSettlement = { found: false, settled: false, invoiceId: null, status: null };

interface Options {
  accounts?: Array<{ user_id: string; stripe_account_id: string }>;
  invoices?: PaidInvoiceFact[];
  local?: (id: string) => LocalSettlement;
  listError?: Error;
  lookupError?: Error;
  accountsError?: Error;
}

function makeDeps(options: Options = {}) {
  const listCalls: Array<{ accountId: string | null; createdSince: Date }> = [];
  const accountPages: Array<string | null> = [];

  const deps: SettlementGapCheckDeps = {
    async pageConnectAccounts(afterUserId, limit) {
      accountPages.push(afterUserId);
      if (options.accountsError) return { data: null, error: options.accountsError };
      const all = options.accounts ?? [];
      const start = afterUserId ? all.findIndex((row) => row.user_id === afterUserId) + 1 : 0;
      return { data: all.slice(start, start + limit), error: null };
    },
    async listPaidInvoices(target, createdSince) {
      listCalls.push({ accountId: target.accountId, createdSince });
      if (options.listError) return { data: null, error: options.listError };
      return { data: { invoices: options.invoices ?? [], hasMore: false }, error: null };
    },
    async findLocalSettlement(stripeInvoiceId) {
      if (options.lookupError) return { data: null, error: options.lookupError };
      return { data: (options.local ?? (() => MISSING))(stripeInvoiceId), error: null };
    },
    now: () => NOW,
  };

  return { deps, listCalls, accountPages };
}

function input(overrides: Partial<Parameters<typeof runSettlementGapCheck>[0]> = {}) {
  return { deadlineAt: NOW.getTime() + 30_000, trigger: 'nightly' as const, ...overrides };
}

describe('the window', () => {
  it('ends at least a full retry grace before now, so a fresh payment is never a finding', () => {
    expect(NOW.getTime() - Date.parse(WINDOW.end)).toBeGreaterThanOrEqual(GAP_CHECK_LIMITS.RETRY_GRACE_MS);
  });

  it('is 48 hours wide', () => {
    expect(Date.parse(WINDOW.end) - Date.parse(WINDOW.start)).toBe(GAP_CHECK_LIMITS.WINDOW_MS);
  });

  /*
   * Two runs minutes apart must audit the SAME window, or a reported window
   * that shifted by milliseconds is indistinguishable from one that moved for a
   * reason — and the adoption guard, which compares two runs' responses, cannot
   * tell either.
   */
  it('is identical for any two moments in the same hour', () => {
    const ragged = settlementWindow(new Date('2026-10-05T12:34:56.789Z'));
    const alsoRagged = settlementWindow(new Date('2026-10-05T12:58:01.002Z'));
    expect(ragged).toEqual(alsoRagged);
    expect(ragged.end.endsWith(':00:00.000Z')).toBe(true);
  });
});

describe('a payment Stripe took that we did not record', () => {
  it('is reported, with the reason that there is no invoice of ours at all', async () => {
    const { deps } = makeDeps({ invoices: [paid('in_1', '2026-10-04T09:00:00.000Z')], local: () => MISSING });
    const { logger, errors } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      stripeInvoiceId: 'in_1',
      reason: 'no_local_invoice',
      amountPaidMinor: 40000,
      currency: 'ils',
    });
    // The error log IS the alert, so it has to carry the finding.
    expect(errors.some(([context]) => context?.event === 'stripe_settlement_gap_found')).toBe(true);
  });

  it('is reported when our invoice exists but was never settled', async () => {
    const { deps } = makeDeps({ invoices: [paid('in_2', '2026-10-04T09:00:00.000Z')], local: () => UNSETTLED });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      reason: 'local_invoice_unsettled',
      localInvoiceId: 'local-1',
      localStatus: 'sent',
    });
  });

  it('is not reported when our invoice is settled', async () => {
    const { deps } = makeDeps({ invoices: [paid('in_3', '2026-10-04T09:00:00.000Z')], local: () => SETTLED });
    const { logger, errors } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.gaps).toEqual([]);
    expect(result.invoicesChecked).toBe(1);
    expect(errors).toEqual([]);
  });
});

describe('the retry grace', () => {
  it('ignores a payment taken minutes ago, which a webhook may still be retrying', async () => {
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const { deps } = makeDeps({ invoices: [paid('in_fresh', tenMinutesAgo)], local: () => MISSING });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.gaps).toEqual([]);
    expect(result.invoicesChecked).toBe(0);
  });

  it('ignores a payment older than the window, so a known gap is not re-reported forever', async () => {
    const { deps } = makeDeps({ invoices: [paid('in_old', '2026-09-25T09:00:00.000Z')], local: () => MISSING });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.gaps).toEqual([]);
  });

  it('ignores an invoice Stripe never stamped with a payment time', async () => {
    const { deps } = makeDeps({ invoices: [paid('in_nopaidat', null)], local: () => MISSING });
    const { logger } = stubLogger();

    expect((await runSettlementGapCheck(input(), deps, logger)).gaps).toEqual([]);
  });
});

describe('the creation lookback', () => {
  /*
   * Stripe cannot filter invoices by the moment of payment, only by creation. A
   * payment plan's instalment invoice is created at booking and paid weeks
   * later, so asking Stripe for invoices created inside the window would miss
   * every plan instalment: the precise case this check exists for.
   */
  it('asks Stripe far further back than the window it audits', async () => {
    const { deps, listCalls } = makeDeps();
    const { logger } = stubLogger();

    await runSettlementGapCheck(input(), deps, logger);

    expect(listCalls.length).toBeGreaterThan(0);
    const askedFrom = listCalls[0].createdSince.getTime();
    expect(askedFrom).toBe(Date.parse(WINDOW.start) - GAP_CHECK_LIMITS.CREATED_LOOKBACK_MS);
    expect(Date.parse(WINDOW.start) - askedFrom).toBeGreaterThanOrEqual(30 * 24 * 60 * 60_000);
  });
});

describe('which accounts get swept', () => {
  it('always asks the platform account, which has its own destination and can break alone', async () => {
    const { deps, listCalls } = makeDeps({ accounts: [] });
    const { logger } = stubLogger();

    await runSettlementGapCheck(input(), deps, logger);

    expect(listCalls.map((call) => call.accountId)).toContain(null);
  });

  it('asks every connected account, and names the business on a finding', async () => {
    const { deps, listCalls } = makeDeps({
      accounts: [
        { user_id: 'user-a', stripe_account_id: 'acct_a' },
        { user_id: 'user-b', stripe_account_id: 'acct_b' },
      ],
      invoices: [paid('in_4', '2026-10-04T09:00:00.000Z')],
      local: () => MISSING,
    });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(listCalls.map((call) => call.accountId)).toEqual([null, 'acct_a', 'acct_b']);
    expect(result.targetsChecked).toBe(3);
    expect(result.gaps.map((gap) => gap.userId)).toEqual([null, 'user-a', 'user-b']);
  });

  it('checks one account only when asked to', async () => {
    const { deps, listCalls } = makeDeps({ accounts: [{ user_id: 'user-a', stripe_account_id: 'acct_a' }] });
    const { logger } = stubLogger();

    await runSettlementGapCheck(input({ accountId: 'acct_z' }), deps, logger);

    expect(listCalls.map((call) => call.accountId)).toEqual(['acct_z']);
  });
});

describe('a run that could not look everywhere never reads as clean', () => {
  it('flags a refused Stripe listing instead of treating the account as owing nothing', async () => {
    const { deps } = makeDeps({ listError: new Error('stripe is down') });
    const { logger, errors } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.listingFailed).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('flags a refused local lookup rather than counting the payment as settled', async () => {
    const { deps } = makeDeps({
      invoices: [paid('in_5', '2026-10-04T09:00:00.000Z')],
      lookupError: new Error('database is down'),
    });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.lookupFailed).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('flags an unreadable account list, and still sweeps the platform account', async () => {
    const { deps, listCalls } = makeDeps({ accountsError: new Error('no rows for you') });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.accountListingFailed).toBe(true);
    expect(listCalls.map((call) => call.accountId)).toEqual([null]);
  });

  /*
   * The dependencies reach Stripe and the database, so a refusal can arrive as
   * a thrown exception rather than as `{ error }` — a revoked key, a missing
   * singleton, a client that does not wrap its network errors. The check
   * promises never to throw, and a monitor that becomes an outage of its own is
   * worse than no monitor.
   */
  it('treats a dependency that throws as a refusal, not an explosion', async () => {
    const deps: SettlementGapCheckDeps = {
      async pageConnectAccounts() {
        throw new TypeError('stripeConnectRepository is undefined');
      },
      async listPaidInvoices() {
        throw new Error('Invalid API key provided');
      },
      async findLocalSettlement() {
        return { data: MISSING, error: null };
      },
      now: () => NOW,
    };
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(result.accountListingFailed).toBe(true);
    expect(result.listingFailed).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('counts the accounts a deadline stopped it from starting', async () => {
    const { deps, listCalls } = makeDeps({
      accounts: [
        { user_id: 'user-a', stripe_account_id: 'acct_a' },
        { user_id: 'user-b', stripe_account_id: 'acct_b' },
      ],
    });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input({ deadlineAt: NOW.getTime() - 1 }), deps, logger);

    expect(listCalls).toEqual([]);
    expect(result.targetsChecked).toBe(0);
    expect(result.targetsNotChecked).toBe(3);
  });
});

describe('paging', () => {
  it('walks connected accounts by keyset until a short page', async () => {
    const accounts = Array.from({ length: GAP_CHECK_LIMITS.ACCOUNT_PAGE_SIZE + 3 }, (_unused, index) => ({
      user_id: `user-${String(index).padStart(3, '0')}`,
      stripe_account_id: `acct_${index}`,
    }));
    const { deps, accountPages } = makeDeps({ accounts });
    const { logger } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(accountPages).toEqual([null, `user-${String(GAP_CHECK_LIMITS.ACCOUNT_PAGE_SIZE - 1).padStart(3, '0')}`]);
    expect(result.targetsChecked).toBe(accounts.length + 1);
  });

  it('stops an account at the page ceiling and says it was only partly read', async () => {
    let pages = 0;
    const deps: SettlementGapCheckDeps = {
      async pageConnectAccounts() {
        return { data: [], error: null };
      },
      async listPaidInvoices() {
        pages += 1;
        return { data: { invoices: [paid(`in_page_${pages}`, '2026-10-04T09:00:00.000Z')], hasMore: true }, error: null };
      },
      async findLocalSettlement() {
        return { data: SETTLED, error: null };
      },
      now: () => NOW,
    };
    const { logger, warns } = stubLogger();

    const result = await runSettlementGapCheck(input(), deps, logger);

    expect(pages).toBe(GAP_CHECK_LIMITS.STRIPE_PAGE_CEILING);
    expect(result.targetsIncomplete).toBe(1);
    expect(warns.length).toBe(1);
  });
});
