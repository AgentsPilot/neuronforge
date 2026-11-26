/**
 * One statement per client per day, however many debts they are late on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-11-26: "I got 8 emails today on invoices. These
 * are the same invoices."
 *
 * They were right twice over. Measured on the live account, one client, every
 * debt ₪400 and due 19 November:
 *
 *   13:40:10 … 13:40:13   SIX overdue chases, one per late instalment
 *   14:40, 15:40, 15:40   an invoice raised for three of those same debts,
 *                         emailed, and then chased AGAIN as an invoice
 *
 * Thirteen emails for about six debts. Nothing was duplicated in the sense of a
 * row written twice: every send was a correct, deduped, once-only reminder
 * about a genuinely distinct database row. Three separate faults compose:
 *
 *   1. the chaser deduped per ITEM, so N late items meant N emails in one run.
 *      `findRecentByContact` existed for exactly this and was wired only into
 *      the agent path — this cron kept asking per invoice and per instalment,
 *      each blind to the other
 *
 *   2. billing a chased instalment moved the dedupe key from `installment_id`
 *      to `invoice_id`, and a brand-new invoice can never have history, so the
 *      24-hour floor was bypassed BY CONSTRUCTION rather than by accident
 *
 *   3. a stage billed after its own due date is born overdue: INV-00062 was
 *      created at 14:40:06 and chased at 14:40:12. Six seconds. The invoice IS
 *      the first request for the money, so nothing is owed-and-ignored yet
 *
 * This is the third visit from this family. `PaymentReminderService.spacing`
 * covers the 2026-10-05 report ("I get reminder for invoices every day, the
 * same invoices"), where the floor was scoped to one reminder TYPE and the
 * three lists could not see each other. Same shape, one level up: the floor was
 * scoped to one ROW and the rows cannot see each other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO GROUPING STEP
 *
 * Consolidation falls out of the key. Asked of the contact, the first late item
 * of a client sends and every other item of that client no-ops, because the
 * reminder just written is `pending` and `pending` counts. Nothing collects the
 * debts into one email; one email simply happens to be what the client gets.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/* Writes `payment_events` through its own client; the caller ignores the
   result, so the shape it already tolerates is kept here minus the request. */
jest.mock('@/lib/services/PaymentEventService', () => ({
  ...jest.requireActual('@/lib/services/PaymentEventService'),
  emitPaymentEvent: async () => ({
    data: null,
    error: new Error('payment events are not written in unit tests'),
  }),
}));

import { PaymentReminderService } from '../PaymentReminderService';

const DAY = 86_400_000;
const USER = '11111111-1111-4111-8111-111111111111';
const CONTACT = 'contact-late-on-everything';
const OTHER_CONTACT = 'contact-late-on-one-thing';

/** The business day the service is told it is, so "7 days late" is exact. */
const TODAY = '2026-11-26';
const DUE = '2026-11-19';

type Row = Record<string, unknown>;

interface Scenario {
  invoices?: Row[];
  installments?: Row[];
  /** Debts already chased under their instalment identity. */
  debtChasedAsStage?: boolean;
  /** Make the client-history read fail, to prove the direction it fails in. */
  clientHistoryError?: boolean;
}

/**
 * A chainable Supabase stub.
 *
 * Every filter returns itself and the object is awaitable, which is all the two
 * scans and the one status update in `processOverdueItems` need. `from()` hands
 * back a fresh builder each call, so the instalment SELECT and the instalment
 * UPDATE on the same table stay distinguishable.
 */
function supabaseStub(scenario: Scenario) {
  const marked: Row[] = [];

  const from = (table: string) => {
    let updating = false;

    const api: Record<string, unknown> = {
      select: () => api,
      in: () => api,
      is: () => api,
      or: () => api,
      lt: () => api,
      eq: () => api,
      not: () => api,
      order: () => api,
      limit: () => api,
      single: () => api,
      maybeSingle: () => api,
      update: (patch: Row) => {
        updating = true;
        marked.push({ table, ...patch });
        return api;
      },
      then: (resolve: (value: unknown) => unknown) => {
        const data = updating
          ? null
          : table === 'payment_invoices'
            ? (scenario.invoices ?? [])
            : table === 'payment_plan_installments'
              ? (scenario.installments ?? [])
              : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };

    return api;
  };

  return { client: { from } as never, marked };
}

/**
 * The service with the collaborators this path touches replaced.
 *
 * `scheduleReminder` is stubbed AND feeds `chasedClients`, which is what makes
 * this a faithful model rather than a convenient one: in production the row it
 * writes is `pending`, and `findRecentByContact` counting `pending` is the
 * entire mechanism under test. A stub that recorded the call without making it
 * visible to the next read would test nothing.
 */
function serviceFor(scenario: Scenario) {
  const { client, marked } = supabaseStub(scenario);
  const service = new PaymentReminderService(client);

  const chasedClients = new Set<string>();
  const scheduled: Row[] = [];

  jest.spyOn(service, 'getUserReminderConfig').mockResolvedValue({
    enabled: true,
    daysBefore: [3],
    overdueDays: [1, 3, 7],
    channels: ['email'],
    defaultChannel: 'email',
    chaseOverdue: true,
  } as never);

  jest.spyOn(service, 'scheduleReminder').mockImplementation(async (_userId, row) => {
    const entry = row as unknown as Row;
    scheduled.push(entry);
    if (typeof entry.contactId === 'string') chasedClients.add(entry.contactId);
    return { data: { id: `reminder-${scheduled.length}` }, error: null } as never;
  });

  const repo = {
    findRecentByContact: jest.fn(async (contactId: string) => {
      if (scenario.clientHistoryError) {
        return { data: null, error: new Error('could not read reminders') };
      }
      return { data: chasedClients.has(contactId) ? [{ id: 'already' }] : [], error: null };
    }),
    findRecentForInvoiceDebt: jest.fn(async () => ({
      data: scenario.debtChasedAsStage ? [{ id: 'chased-as-stage' }] : [],
      error: null,
    })),
    findRecentByInvoice: jest.fn(async () => ({ data: [], error: null })),
    findRecentByInstallment: jest.fn(async () => ({ data: [], error: null })),
  };

  (service as unknown as { reminderRepo: unknown }).reminderRepo = repo;
  /* The clock and the send window are not what these tests are about, and both
     have their own suites (`reminderSendWindow`, `PaymentReminderService.overdueDays`). */
  (service as unknown as { isSendHour: unknown }).isSendHour = async () => true;
  (service as unknown as { businessToday: unknown }).businessToday = async () => TODAY;
  (service as unknown as { businessZone: unknown }).businessZone = async () => 'UTC';

  return { service, repo, scheduled, marked };
}

/** A late instalment of the client who is late on everything. */
const stage = (id: string, contactId = CONTACT): Row => ({
  id,
  user_id: USER,
  contact_id: contactId,
  due_date: DUE,
});

/** A late invoice, raised long enough ago to be chaseable. */
const invoice = (id: string, overrides: Row = {}): Row => ({
  id,
  user_id: USER,
  contact_id: CONTACT,
  due_date: DUE,
  booking_id: null,
  payment_terms: null,
  created_at: new Date(Date.now() - 10 * DAY).toISOString(),
  ...overrides,
});

describe('a client late on six things', () => {
  const sixStages = ['s1', 's2', 's3', 's4', 's5', 's6'].map(id => stage(id));

  it('is written to once, not six times', async () => {
    /* The reported burst: six emails between 13:40:10 and 13:40:13. */
    const { service, scheduled } = serviceFor({ installments: sixStages });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].installmentId).toBe('s1');
  });

  it('and every one of the six is still marked overdue', async () => {
    /*
     * THE REGRESSION THIS FIX NEARLY SHIPPED. The gate cannot be a `continue`:
     * the loop body carries on past it to stamp the period `overdue`, and five
     * of six stages left `pending` would misreport the debt in the drawer, the
     * money page and the reports at once — while the emails looked fixed.
     *
     * Suppressing the EMAIL is the whole of the change. It must not touch what
     * the data says is owed.
     */
    const { service, marked } = serviceFor({ installments: sixStages });

    await service.processOverdueItems();

    const stamped = marked.filter(
      row => row.table === 'payment_plan_installments' && row.status === 'overdue'
    );
    expect(stamped).toHaveLength(6);
  });

  it('and a different client is still chased in the same run', async () => {
    /*
     * The floor is per client, not per run. A run that fell silent after one
     * email would be a far worse bug than the one being fixed, and an
     * account-wide flag would read exactly like this test passing.
     */
    const { service, scheduled } = serviceFor({
      installments: [...sixStages, stage('other-1', OTHER_CONTACT)],
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(2);
    expect(scheduled.map(row => row.contactId)).toEqual([CONTACT, OTHER_CONTACT]);
  });
});

describe('the same debt under its two names', () => {
  it('is not chased as an invoice when it was chased as an instalment', async () => {
    /* 13:40 as instalment 338a7712, 14:40 as INV-00062. One ₪400 debt. */
    const { service, scheduled } = serviceFor({
      invoices: [invoice('inv-already-chased')],
      debtChasedAsStage: true,
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(0);
  });

  it('is chased when the debt has no earlier identity', async () => {
    /* An ad-hoc invoice with no instalments behind it must still be chased;
       the check abstains rather than suppressing. */
    const { service, scheduled } = serviceFor({
      invoices: [invoice('inv-adhoc')],
      debtChasedAsStage: false,
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].invoiceId).toBe('inv-adhoc');
  });

  it('and one pass is visible to the other inside a single run', async () => {
    /*
     * Both passes run in one invocation, invoices first. The reminder written
     * there is `pending`, so the instalment pass sees the client has already
     * had their statement. Without this the fix would halve the emails rather
     * than reduce them to one.
     */
    const { service, scheduled } = serviceFor({
      invoices: [invoice('inv-1')],
      installments: [stage('s1')],
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].invoiceId).toBe('inv-1');
  });
});

describe('an invoice raised after its own due date', () => {
  it('is not chased in the minute it is sent', async () => {
    /* INV-00062: created 14:40:06, chased 14:40:12. */
    const { service, scheduled } = serviceFor({
      invoices: [invoice('inv-newborn', { created_at: new Date().toISOString() })],
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(0);
  });

  it('but is chased once it has been sitting a day', async () => {
    /*
     * The grace is a floor, not an amnesty. A debt that stays unpaid must still
     * be chased, or this fix would turn a nuisance into lost money.
     */
    const { service, scheduled } = serviceFor({
      invoices: [
        invoice('inv-day-old', { created_at: new Date(Date.now() - 2 * DAY).toISOString() }),
      ],
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
  });

  it('and an invoice with no creation time is not held back', async () => {
    /* An unreadable date must not silently stop a debt being chased for ever;
       the other two floors still apply to it. */
    const { service, scheduled } = serviceFor({
      invoices: [invoice('inv-undated', { created_at: null })],
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
  });
});

describe('when the client history cannot be read', () => {
  it('nobody is chased', async () => {
    /*
     * FAILS CLOSED, and deliberately the opposite way round from the spacing
     * floor in `PaymentReminderService.spacing`, which sends when its check
     * errors because "an invoice silently never chased is money".
     *
     * The asymmetry is the point. That floor decides WHETHER a debt is ever
     * chased; this one decides whether a client hears about it twice in a day.
     * An unreadable history is the moment a duplicate is most likely, this cron
     * re-runs within the hour, and the milestones are days apart — so the cost
     * of waiting is an hour and the cost of guessing is the reported bug.
     */
    const { service, scheduled } = serviceFor({
      installments: [stage('s1')],
      invoices: [invoice('inv-1')],
      clientHistoryError: true,
    });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(0);
  });

  it('but the periods are still marked overdue', async () => {
    /* Same reasoning as above: the email is suppressed, never the bookkeeping. */
    const { service, marked } = serviceFor({
      installments: [stage('s1')],
      clientHistoryError: true,
    });

    await service.processOverdueItems();

    expect(
      marked.filter(row => row.status === 'overdue')
    ).toHaveLength(1);
  });
});

describe('what must not change', () => {
  it('a client late on one thing is chased exactly as before', async () => {
    const { service, scheduled } = serviceFor({ installments: [stage('only-one')] });

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].reminderType).toBe('overdue');
  });

  it('consent is still asked before anything else', async () => {
    /* `chaseOverdue` is the business saying we may write to its clients at all.
       No floor may become a reason to skip that question. */
    const { service, scheduled } = serviceFor({ installments: [stage('s1')] });

    jest.spyOn(service, 'getUserReminderConfig').mockResolvedValue({
      enabled: true,
      daysBefore: [3],
      overdueDays: [1, 3, 7],
      channels: ['email'],
      defaultChannel: 'email',
      chaseOverdue: false,
    } as never);

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(0);
  });

  it('and a debt that is not yet late is not chased', async () => {
    /* `overdueDays` is 1/3/7; a stage four days late matches no milestone. */
    const { service, scheduled } = serviceFor({
      installments: [stage('s1')],
    });

    (service as unknown as { businessToday: unknown }).businessToday = async () => '2026-11-23';

    await service.processOverdueItems();

    expect(scheduled).toHaveLength(0);
  });
});
