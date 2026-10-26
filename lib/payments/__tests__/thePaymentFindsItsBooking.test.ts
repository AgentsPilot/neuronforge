/**
 * A payment made before its booking exists still finds it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reproduced from a live incident. A client paid on a smart link and was
 * refunded four minutes later; the refund reached Stripe and did nothing
 * visible here. Two writes, 117 milliseconds apart, in the wrong order:
 *
 *   15:36:56.474   booking row written, and it stamps the transaction
 *   15:36:56.591   transaction row written by the Stripe webhook
 *
 * The stamp ran `WHERE stripe_payment_intent_id = … AND booking_id IS NULL`
 * against a row that did not exist yet. It updated nothing, said nothing, and
 * the payment was never attached to the booking. Everything that locates a
 * booking's money by `booking_id` then found none:
 *
 *   the refund left `payment_status: paid` on the booking, because
 *   `syncBookingPaymentState` finds nothing settled and returns BEFORE its
 *   write, and the client was never emailed, because `notifyRefund` resolves
 *   the recipient through that same link.
 *
 * The owner's own booking flow books first and pays second, so it was never
 * affected, which is why this looked like it worked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Rows the fake database holds, rewritten per test. */
let transactions: Array<Record<string, unknown>> = [];
/** How many polls the transaction takes to appear. 0 = it is already there. */
let appearsAfterPolls = 0;
let polls = 0;
/** Bookings settled by the linker, in order. */
const settled: Array<{ bookingId: string; userId: string }> = [];

/**
 * The rows a statement can see right now.
 *
 * The webhook's row exists in `transactions` from the start, because the test
 * needs to assert on it afterwards, but it is invisible to the database until
 * enough reads have gone by. Every statement — read AND write — goes through
 * here, so nothing can touch a row that has not landed.
 *
 * `>=`, not `>`: at `appearsAfterPolls: 0` the row is there before anyone
 * looks. With `>` it took one read to materialise, which made the row invisible
 * to code that does not poll — so removing the fix failed the already-there
 * case too, and that case genuinely worked during the incident. A test that
 * overstates which cases were broken is as misleading as one that misses them.
 */
const rowsInTheDatabase = () => (polls >= appearsAfterPolls ? transactions : []);

/**
 * The instalment half of the catalogue.
 *
 * A plan sale links through `payment_plan_subscriptions` and
 * `payment_plan_installments` instead of a single charge, and it reaches the
 * same settle. Empty for the one-off tests, which never touch these tables.
 */
let subscriptions: Array<Record<string, unknown>> = [];
let installments: Array<Record<string, unknown>> = [];
/** What Stripe's search returns for the attempt. */
let stripeHolds: 'payment_intent' | 'subscription' = 'payment_intent';

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;

      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.limit = () => builder;
      /* `maybeSingle` resolves to ONE row, not an array. `waitForLocalSubscription`
         reads `data?.id` off it, so returning the array would read as undefined and
         the wait would give up on a row that is sitting right there. */
      let single = false;
      builder.maybeSingle = () => {
        single = true;
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      builder.is = (column: string, value: unknown) => {
        filters[`is:${column}`] = value;
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        filters[`in:${column}`] = values;
        return builder;
      };
      builder.update = (values: Record<string, unknown>) => {
        patch = values;
        return builder;
      };

      /* Resolved lazily, so a `select` that is awaited and one that is chained
         behave the same way. */
      builder.then = (resolve: (value: unknown) => unknown) => {
        /* The instalment tables. No race modelled on these: the subscription
           path already waited for its row, and what is under test here is that
           linking it reaches the settle. */
        if (table === 'payment_plan_subscriptions' || table === 'payment_plan_installments') {
          const rows = table === 'payment_plan_subscriptions' ? subscriptions : installments;
          if (!patch) return resolve({ data: single ? (rows[0] ?? null) : rows, error: null });

          const matched = rows.filter(row => filters['is:booking_id'] !== null || row.booking_id == null);
          for (const row of matched) Object.assign(row, patch);
          return resolve({ data: matched, error: null });
        }

        /* `scheduling_bookings`, which only ever takes a write here. */
        if (table !== 'payment_transactions') return resolve({ data: [], error: null });

        /* The charges an instalment names, fetched by id rather than by intent. */
        if (filters['in:id']) {
          const wanted = filters['in:id'] as string[];
          const matched = transactions.filter(
            row => wanted.includes(row.id as string) && (!patch || row.booking_id == null)
          );
          if (patch) for (const row of matched) Object.assign(row, patch);
          return resolve({ data: matched.map(row => ({ id: row.id })), error: null });
        }

        if (!patch) {
          /* A read. The webhook's row only appears once it has been looked for
             enough times, which is the race being reproduced. Visibility is
             read BEFORE the count moves, or the row lands on the very read that
             was supposed to miss it and nothing ever waits. */
          const matched = rowsInTheDatabase().filter(
            row => row.stripe_payment_intent_id === filters.stripe_payment_intent_id
          );
          polls += 1;
          return resolve({ data: matched, error: null });
        }

        /*
         * A write, against WHAT THE DATABASE ACTUALLY HOLDS.
         *
         * This is the whole point of the fake, and it read `transactions`
         * directly at first — so an UPDATE matched a row the webhook had not
         * written yet, the incident could not be reproduced, and the test
         * passed against the broken code as happily as the fixed code.
         *
         * The same visibility rule has to apply to both statements, because in
         * the real failure the row genuinely is not there to be updated.
         */
        const matched = rowsInTheDatabase().filter(
          row =>
            row.stripe_payment_intent_id === filters.stripe_payment_intent_id
            && (filters['is:booking_id'] !== null || row.booking_id == null)
        );
        for (const row of matched) Object.assign(row, patch);
        return resolve({ data: matched.map(row => ({ id: row.id })), error: null });
      };

      return builder;
    },
  },
}));

/*
 * Which Stripe account to ask. Not the subject here, and it reads the database
 * itself — left unmocked it returns no accounts, `findInStripe` gives up before
 * any of the timing below runs, and every assertion fails for the wrong reason.
 */
jest.mock('../stripeAccountContext', () => ({
  resolveUserConnectAccounts: jest.fn(async () => [{ accountId: 'acct_live_1' }]),
}));

jest.mock('@/lib/payments/syncBookingPaymentState', () => ({
  syncBookingPaymentState: jest.fn(async (bookingId: string, userId: string) => {
    settled.push({ bookingId, userId });
    return { status: 'refunded', paid: 0, refunded: 50 };
  }),
}));

global.fetch = jest.fn(async (url: unknown) => {
  const target = String(url);
  /* The attempt's money, as `findInStripe` looks it up. It asks subscriptions
     first and payment intents second, so only the one Stripe holds answers. */
  if (target.includes('subscriptions/search') && stripeHolds === 'subscription') {
    return { ok: true, json: async () => ({ data: [{ id: 'sub_live_1' }] }) } as unknown as Response;
  }
  if (target.includes('payment_intents/search') && stripeHolds === 'payment_intent') {
    return { ok: true, json: async () => ({ data: [{ id: 'pi_live_1' }] }) } as unknown as Response;
  }
  return { ok: true, json: async () => ({ data: [] }) } as unknown as Response;
}) as unknown as typeof fetch;

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  transactions = [
    {
      id: 'tx-1',
      user_id: 'owner-1',
      stripe_payment_intent_id: 'pi_live_1',
      booking_id: null,
      contact_id: null,
    },
  ];
  appearsAfterPolls = 0;
  polls = 0;
  settled.length = 0;
  subscriptions = [];
  installments = [];
  stripeHolds = 'payment_intent';
  jest.clearAllMocks();
});

afterAll(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
});

const link = async () => {
  const { linkPaymentsToBooking } = await import('../linkPaymentsToBooking');
  return linkPaymentsToBooking({
    attemptId: 'attempt-1',
    bookingId: 'booking-1',
    contactId: 'contact-1',
    userId: 'owner-1',
  });
};

describe('when the webhook row is already there', () => {
  it('links the payment to the booking', async () => {
    const result = await link();

    expect(result.transactions).toBe(1);
    expect(transactions[0].booking_id).toBe('booking-1');
    expect(transactions[0].contact_id).toBe('contact-1');
  });

  it('settles the booking, so a refund already taken is reflected', async () => {
    /*
     * The half that made the incident permanent. Linking alone would have left
     * `payment_status: paid` on a booking whose money had already gone back,
     * because the sync that corrects it runs at REFUND time and had no booking
     * to find then.
     */
    await link();

    expect(settled).toEqual([{ bookingId: 'booking-1', userId: 'owner-1' }]);
  });
});

describe('when the webhook row lands after the booking', () => {
  it('waits for it instead of stamping nothing', async () => {
    /* The live timing: the booking at .474, the transaction at .591. */
    appearsAfterPolls = 1;

    const result = await link();

    expect(result.transactions).toBe(1);
    expect(transactions[0].booking_id).toBe('booking-1');
  });

  it('still settles the booking once the link is made', async () => {
    appearsAfterPolls = 2;

    await link();

    expect(settled).toEqual([{ bookingId: 'booking-1', userId: 'owner-1' }]);
  });
});

describe('when no payment arrives at all', () => {
  it('links nothing and leaves the booking alone', async () => {
    /*
     * A booking that was never paid for. The old code reached the same answer
     * by accident; this one reaches it on purpose, and says so in the log, so
     * the reconcile can pick it up if money turns out to exist later.
     */
    appearsAfterPolls = 99;

    const result = await link();

    expect(result.transactions).toBe(0);
    expect(transactions[0].booking_id).toBeNull();
    expect(settled).toEqual([]);
  });
});

describe('an instalment sale', () => {
  /*
   * THE OTHER HALF OF THE CATALOGUE.
   *
   * The settle was added to the one-off charge path first, because that is what
   * the incident ran through. A plan sale reaches the same bad end by a longer
   * road: the subscription row can lag further behind than a charge row, and
   * the reconcile pass may link it a quarter of an hour after the refund — by
   * which time the booking has been reading "paid" the whole time.
   *
   * Nothing here is about the race. It asserts only that linking a plan sale
   * settles the booking, as linking a charge does.
   */
  beforeEach(() => {
    stripeHolds = 'subscription';
    subscriptions = [{ id: 'sub-local-1', user_id: 'owner-1', booking_id: null }];
    installments = [
      {
        id: 'inst-1',
        user_id: 'owner-1',
        booking_id: null,
        payment_plan_id: 'plan-1',
        transaction_id: 'tx-1',
      },
    ];
  });

  it('links the subscription and its periods', async () => {
    const result = await link();

    expect(result.subscriptions).toBe(1);
    expect(result.installments).toBe(1);
    expect(result.planId).toBe('plan-1');
    expect(subscriptions[0].booking_id).toBe('booking-1');
  });

  it('settles the booking, so a refunded plan is not left reading paid', async () => {
    await link();

    expect(settled).toEqual([{ bookingId: 'booking-1', userId: 'owner-1' }]);
  });
});

describe('a payment already linked', () => {
  it('is not stamped a second time', async () => {
    transactions[0].booking_id = 'booking-earlier';

    const result = await link();

    expect(result.transactions).toBe(0);
    expect(transactions[0].booking_id).toBe('booking-earlier');
  });
});
