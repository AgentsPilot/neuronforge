/**
 * The next invoice number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WORTH TESTING
 *
 * The number is printed on a document the business sends to a client and gives
 * to an accountant. A wrong one is not a display bug: a repeated number is a
 * duplicate tax invoice, and a series that jumps is a question somebody has to
 * answer at audit.
 *
 * Three faults lived in the old implementation, and each produced a wrong number
 * silently:
 *
 *   1. `INV-` was hardcoded, so the business's own `invoice_number_prefix` was
 *      ignored. A prefix-aware generator existed beside it with zero callers.
 *   2. `replace(/\D/g, '')` stripped every non-digit, folding a prefix that
 *      contains digits into the counter.
 *   3. `order('created_at').limit(1)` took the most recently CREATED invoice
 *      rather than the highest-numbered one, so one backdated or imported row
 *      restarted the series over numbers already issued.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Row = { invoice_number: string };

const state: {
  prefix: string | null;
  rows: Row[];
  lastLike: string | null;
  lastOrder: string | null;
} = { prefix: null, rows: [], lastLike: null, lastOrder: null };

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const supabase = {
  from(table: string) {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.ilike = (_col: string, pattern: string) => {
      state.lastLike = pattern;
      return builder;
    };
    builder.order = (col: string) => {
      state.lastOrder = col;
      return Promise.resolve({ data: state.rows, error: null }) as never;
    };
    builder.limit = () => Promise.resolve({ data: state.rows, error: null });
    builder.maybeSingle = async () =>
      table === 'business_profiles'
        ? { data: { invoice_number_prefix: state.prefix }, error: null }
        : { data: null, error: null };
    // `.order(...).limit(...)` — order returns a thenable that also has limit.
    const orderable = builder.order as (col: string) => unknown;
    builder.order = (col: string) => {
      state.lastOrder = col;
      void orderable;
      return {
        limit: () => Promise.resolve({ data: state.rows, error: null }),
      };
    };
    return builder;
  },
};

import { PaymentInvoiceRepository } from '../PaymentRepository';

const repo = new PaymentInvoiceRepository(supabase as never);

beforeEach(() => {
  state.prefix = null;
  state.rows = [];
  state.lastLike = null;
  state.lastOrder = null;
});

describe("the business's own prefix is used", () => {
  it('uses the configured prefix instead of INV', async () => {
    state.prefix = 'AP';
    state.rows = [{ invoice_number: 'AP-00006' }];

    const { data } = await repo.getNextInvoiceNumber('u1');

    expect(data).toBe('AP-00007');
  });

  it('falls back to INV when none is set', async () => {
    // Every invoice already issued carries INV, so this is the only safe default.
    state.prefix = null;
    state.rows = [{ invoice_number: 'INV-00003' }];

    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('INV-00004');
  });

  it('falls back to INV when the setting is blank', async () => {
    // An empty string is a cleared field, not a prefix of nothing.
    state.prefix = '   ';
    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('INV-00001');
  });

  it('starts at 1 for a business with no invoices yet', async () => {
    state.prefix = 'BILL';
    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('BILL-00001');
  });
});

describe('a prefix containing digits does not corrupt the counter', () => {
  it('keeps the year out of the number', async () => {
    /*
     * The old `replace(/\D/g, '')` turned "2026-INV-00006" into 202600006 and
     * returned 202600007. A year in the prefix is an ordinary thing to want.
     */
    state.prefix = '2026-INV';
    state.rows = [{ invoice_number: '2026-INV-00006' }];

    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('2026-INV-00007');
  });
});

describe('the highest number wins, not the newest row', () => {
  it('takes the maximum across the series', async () => {
    /*
     * A backdated or imported invoice used to restart the series from itself,
     * re-issuing numbers already sent to clients.
     */
    state.prefix = 'INV';
    state.rows = [
      { invoice_number: 'INV-00002' },
      { invoice_number: 'INV-00009' },
      { invoice_number: 'INV-00004' },
    ];

    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('INV-00010');
  });

  it('orders by invoice_number, not created_at', async () => {
    state.prefix = 'INV';
    state.rows = [{ invoice_number: 'INV-00001' }];

    await repo.getNextInvoiceNumber('u1');

    expect(state.lastOrder).toBe('invoice_number');
  });

  it('ignores numbers from a different series', async () => {
    // The regex is anchored, so a longer prefix cannot leak in.
    state.prefix = 'INV';
    state.rows = [{ invoice_number: 'INV-00002' }, { invoice_number: 'INVX-00099' }];

    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('INV-00003');
  });
});

describe('the prefix is user input and reaches two pattern languages', () => {
  it('escapes ilike wildcards', async () => {
    /*
     * `_` matches any character to `ilike`, so `A_B` would have matched `AxB`
     * and pulled another series' numbers into this one's maximum.
     */
    state.prefix = 'A_B';
    await repo.getNextInvoiceNumber('u1');

    expect(state.lastLike).toBe('A\\_B-%');
  });

  it('survives a prefix with regex metacharacters', async () => {
    // Unescaped, `INV.` would let `INVX-00099` match and poison the series.
    state.prefix = 'INV.';
    state.rows = [{ invoice_number: 'INV.-00002' }, { invoice_number: 'INVX-00099' }];

    expect((await repo.getNextInvoiceNumber('u1')).data).toBe('INV.-00003');
  });
});
