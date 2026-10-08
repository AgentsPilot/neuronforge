/**
 * The event rail must never be able to break the thing it is recording.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rail records what HAPPENED, so every emit sits behind a write that has
 * already committed: the booking is booked, the invoice is paid, the refund is
 * issued. The business fact is true the moment the row lands and the event is a
 * note about it, which is what makes fire-and-forget correct here rather than a
 * shortcut -- there is nothing to roll back.
 *
 * Which makes ONE property load-bearing, and it is the only one worth a test: a
 * rail that is down, slow, or not migrated on this account must be invisible to
 * the caller. Seven call sites across three repositories depend on it, and
 * every one of them sits inside a payment or booking path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const debug = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug, info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const emit = jest.fn();
jest.mock('../BusinessEventService', () => ({
  // A getter, so the module-scope `new BusinessEventService(supabaseServer)` in
  // the real file -- which builds a client the moment it is imported -- never
  // runs in this test.
  get businessEventService() {
    return { emit };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordBusinessEvent } = require('../recordEvent') as typeof import('../recordEvent');

const PARAMS = {
  eventType: 'invoice.paid',
  category: 'cash_flow',
  entityType: 'invoice',
  entityId: 'inv-1',
  sourceCapability: 'payments',
} as const;

/** Let the floating promise inside `recordBusinessEvent` settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  debug.mockClear();
  emit.mockReset();
});

describe('recordBusinessEvent', () => {
  it('returns nothing, so no caller can await it', () => {
    /*
     * The signature is the guard. A function returning a promise invites an
     * `await` in a payment path, and the next person to add a call site reads
     * the type before they read the comment.
     */
    emit.mockResolvedValue({ data: null, error: null });
    expect(recordBusinessEvent('user-1', { ...PARAMS })).toBeUndefined();
  });

  it('passes the event through when the rail is healthy', async () => {
    emit.mockResolvedValue({ data: { id: 'evt-1' }, error: null });

    recordBusinessEvent('user-1', { ...PARAMS });
    await settle();

    expect(emit).toHaveBeenCalledWith('user-1', expect.objectContaining({
      eventType: 'invoice.paid',
      entityId: 'inv-1',
    }));
  });

  it('swallows a rejecting rail', async () => {
    // A dead table, a network failure, a migration not applied on this project.
    emit.mockRejectedValue(new Error('relation "business_events" does not exist'));

    expect(() => recordBusinessEvent('user-1', { ...PARAMS })).not.toThrow();
    await settle();

    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.paid' }),
      'Event rail write skipped'
    );
  });

  it('swallows a returned error as well as a thrown one', async () => {
    /*
     * `BusinessEventService.emit` catches internally and resolves with
     * `{ error }`, so a rail failure arrives as a VALUE, not a rejection. A
     * `.catch` alone would have let these pass silently with no log at all.
     */
    emit.mockResolvedValue({ data: null, error: new Error('insert failed') });

    recordBusinessEvent('user-1', { ...PARAMS });
    await settle();

    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'invoice.paid' }),
      'Event rail write skipped'
    );
  });

  it('logs at debug, not warn', async () => {
    /*
     * On an account where the rail is behind, every payment would otherwise
     * produce a warning, and a log that cries wolf on healthy traffic is a log
     * nobody reads.
     */
    emit.mockRejectedValue(new Error('nope'));
    recordBusinessEvent('user-1', { ...PARAMS });
    await settle();

    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('exactly one writer per event type', () => {
  const read = (file: string) =>
    readFileSync(join(__dirname, '..', '..', '..', '..', 'repositories', file), 'utf8');

  it('SchedulingRepository owns the three booking end-states', () => {
    /*
     * `update()` is the only path that changes booking status, so these three
     * have no bypass and stay in the application, where they are emitted off an
     * atomic `.neq('status', target)` claim.
     */
    const src = read('SchedulingRepository.ts');

    expect(src).toContain('recordBusinessEvent');
    expect(src).toContain('emitBookingStatusEvent');
  });

  it.each(['PaymentRepository.ts', 'ProposalRepository.ts'])(
    '%s emits nothing, because a trigger does',
    file => {
      /*
       * THE DUPLICATION GUARD. These types are written by
       * `20261006_business_event_triggers.sql`, because the Stripe webhook and
       * the public booking route write these tables directly and never reach a
       * repository -- so an application emit here captured only the owner's own
       * actions and missed every automated one.
       *
       * Adding an emit back into either file would mean TWO writers for the
       * same event and a duplicate per transaction. If a future change needs
       * one here, remove the corresponding branch from the trigger first.
       */
      expect(read(file)).not.toContain('recordBusinessEvent');
    }
  );

  it('does not emit booking.created from the repository', () => {
    /*
     * The client-facing booking route inserts directly, so this one moved to
     * the trigger while the status events stayed. Both halves of that split
     * have to hold or bookings are counted twice.
     */
    const src = read('SchedulingRepository.ts');

    expect(src).not.toMatch(/eventType: 'booking\.created'/);
  });
});

describe('LeadAlertService emits names the taxonomy has', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * FOUND 2026-10-06 while auditing coverage. The second emit was built by
   * string interpolation and cast past the type checker:
   *
   *   eventType: input.kind === 'enquiry' ? 'form.submitted'
   *            : input.kind === 'quote'   ? 'quote.requested'
   *            : `booking.${input.kind}`
   *   ... as Parameters<typeof businessEventService.emit>[1]
   *
   * Two of the four kinds produced a name absent from `BusinessEventType`, so
   * `getCategoryForEventType` returned undefined, `business_events.category` is
   * NOT NULL, and the insert failed into a swallowed `.catch`. A quote request
   * and a reschedule emitted NOTHING, silently, for the life of the service.
   *
   * The fourth kind had the opposite bug: `cancelled` emitted
   * `booking.cancelled`, which the repository ALSO emits, so every client
   * cancellation was two events. One booking in live data carried five.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const service = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'services', 'LeadAlertService.ts'),
    'utf8'
  );
  const types = readFileSync(join(__dirname, '..', 'types.ts'), 'utf8');

  /** The file with comment lines removed: the doc comment QUOTES the old bug. */
  const code = service
    .split('\n')
    .filter(line => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('builds no event name by interpolation', () => {
    // A template literal cannot be checked against a union.
    expect(code).not.toMatch(/eventType:\s*`/);
    expect(code).not.toMatch(/`booking\.\$\{/);
  });

  it('no longer casts past the union', () => {
    /*
     * The cast is what made the two invalid names compile. Without it the
     * compiler rejects anything the taxonomy does not declare, which is the
     * only reason this class of bug can hide.
     */
    expect(service).not.toContain('as Parameters<typeof businessEventService.emit>[1]');
  });

  it('maps every kind explicitly, including the one that emits nothing', () => {
    const map = service.slice(
      service.indexOf('const SECOND_EVENT'),
      service.indexOf('const secondEvent')
    );

    expect(map.length).toBeGreaterThan(50);
    expect(map).toMatch(/enquiry: 'form\.submitted'/);
    expect(map).toMatch(/quote: 'quote\.requested'/);
    expect(map).toMatch(/moved: 'booking\.rescheduled'/);
    // The duplication fix: the repository owns booking.cancelled.
    expect(map).toMatch(/cancelled: null/);
  });

  it('does not emit booking.cancelled, which the repository owns', () => {
    expect(code).not.toContain("'booking.cancelled'");
  });

  it('declares the two names that were previously invalid', () => {
    for (const type of ['quote.requested', 'booking.rescheduled']) {
      // In the union AND in the category map; either alone still fails to insert.
      expect(types).toContain(`| '${type}'`);
      expect(types).toContain(`'${type}':`);
    }
  });

  it('every type in the union has a category', () => {
    /*
     * The root cause generalised. A name in the union with no category entry
     * yields undefined, and the NOT NULL column rejects the row -- which is
     * invisible, because every emit swallows its own failure.
     */
    const union = types.slice(0, types.indexOf('EVENT_TYPE_TO_CATEGORY'));
    const mapped = types.slice(types.indexOf('EVENT_TYPE_TO_CATEGORY'));

    const declared = [...union.matchAll(/^\s*\| '([a-z_]+\.[a-z_]+)'/gm)].map(m => m[1]);
    expect(declared.length).toBeGreaterThan(40);

    for (const type of declared) {
      expect(mapped).toContain(`'${type}':`);
    }
  });
});

describe('the gap-closing migration', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261006c_close_remaining_event_gaps.sql'),
    'utf8'
  );

  it('is a real file', () => {
    expect(sql.length).toBeGreaterThan(2000);
  });

  it.each([
    'page.viewed',
    'page.session_started',
    'contact.created',
    'contact.stage_changed',
    'enquiry.replied',
    'booking.confirmed',
    'invoice.sent',
    'proposal.viewed',
    'pricing.changed',
    'service.created',
    'service.updated',
    'service.disabled',
  ])('records %s', eventType => {
    expect(sql).toContain(`'${eventType}'`);
  });

  it('unstarves the three metrics a trigger can reach', () => {
    /*
     * `MetricsComputeService` counts `business_events` by type, and a metric
     * definition has NO table option -- the rail is its only possible input.
     * Five of its ten declared types were never emitted; these three are the
     * ones a row-level trigger can observe.
     */
    for (const type of ['page.viewed', 'contact.created', 'enquiry.replied']) {
      expect(sql).toContain(`'${type}'`);
    }
  });

  it('still leaves the booking end-states to the application', () => {
    /*
     * This migration gives the booking trigger an UPDATE arm for `confirmed`,
     * which is the one status change the application does NOT own. If it ever
     * handles cancelled/completed/no_show as well, every one of those is
     * counted twice.
     */
    const bookingFn = sql.slice(
      sql.indexOf('FUNCTION public.tg_booking_events'),
      sql.indexOf('DROP TRIGGER IF EXISTS trg_booking_events')
    );

    expect(bookingFn.length).toBeGreaterThan(200);
    expect(bookingFn).toContain("NEW.status = 'confirmed'");
    expect(bookingFn).not.toMatch(/NEW\.status IN \('cancelled'/);
    expect(bookingFn).not.toContain("'booking.cancelled'");
    expect(bookingFn).not.toContain("'booking.completed'");
    expect(bookingFn).not.toContain("'booking.no_show'");
  });

  it('excludes the owner viewing their own page', () => {
    // `countUniqueVisitors` excludes these too, and the two must agree or the
    // visitor metric and the conversion vector will disagree about the audience.
    expect(sql).toContain('NEW.is_owner_view IS TRUE');
  });

  it('counts a session once, on its first view', () => {
    expect(sql).toMatch(/NOT EXISTS[\s\S]{0,200}v\.session_id = NEW\.session_id/);
  });

  it('treats a price change as pricing.changed, not service.updated', () => {
    /*
     * One edit, one event. `service.updated` is explicitly guarded against
     * firing alongside a price change or a disable, both of which are more
     * specific statements about the same write.
     */
    expect(sql).toMatch(/OLD\.price IS NOT DISTINCT FROM NEW\.price/);
  });

  it('keeps the reply vocabulary in step with the detector', () => {
    /*
     * The outbound set is duplicated from `SalesReplySlowDetector`. If they
     * drift, the metric and the detector disagree about what a reply is.
     */
    const detector = readFileSync(
      join(__dirname, '..', '..', 'detectors', 'catalog', 'SalesReplySlowDetector.ts'),
      'utf8'
    );
    const outbound = detector
      .slice(detector.indexOf('const OUTBOUND'), detector.indexOf(']);', detector.indexOf('const OUTBOUND')))
      .match(/'([a-z_]+)'/g) ?? [];

    expect(outbound.length).toBeGreaterThan(3);
    for (const type of outbound) {
      expect(sql).toContain(type);
    }
  });

  it('is safe to apply twice', () => {
    const triggers = sql.match(/CREATE TRIGGER/g) ?? [];
    const drops = sql.match(/DROP TRIGGER IF EXISTS/g) ?? [];

    expect(drops).toHaveLength(triggers.length);
  });

  it('pins search_path on every SECURITY DEFINER function', () => {
    const code = sql
      .split('\n')
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('*'))
      .join('\n');

    expect(code.match(/SET search_path = public/g) ?? [])
      .toHaveLength((code.match(/SECURITY DEFINER/g) ?? []).length);
  });
});

describe('the trigger migration covers what the application cannot', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261006_business_event_triggers.sql'),
    'utf8'
  );

  it('is a real file, so these assertions mean something', () => {
    expect(sql.length).toBeGreaterThan(2000);
  });

  it.each([
    'booking.created',
    'invoice.created',
    'invoice.paid',
    'invoice.overdue',
    'payment.completed',
    'refund.completed',
    'proposal.sent',
    'proposal.accepted',
    'proposal.rejected',
  ])('records %s', eventType => {
    expect(sql).toContain(`'${eventType}'`);
  });

  it('leaves the booking end-states to the application', () => {
    // The other half of the one-writer rule: an INSERT-only booking trigger.
    expect(sql).toMatch(/AFTER INSERT ON public\.scheduling_bookings/);
    expect(sql).not.toMatch(/AFTER INSERT OR UPDATE ON public\.scheduling_bookings/);
  });

  it('compares statuses with IS DISTINCT FROM, never <>', () => {
    /*
     * `NULL <> 'paid'` is NULL, which would skip the event. And the comparison
     * being OLD-vs-NEW inside one row's transaction is what makes the trigger
     * immune to the race that produced `booking.completed` three times in 0.7
     * seconds through the application path.
     */
    expect(sql).toMatch(/OLD\.status IS DISTINCT FROM NEW\.status/);
    expect(sql).not.toMatch(/OLD\.status\s*<>\s*NEW\.status/);
  });

  it('never lets the rail fail the business write', () => {
    // A trigger on payment tables that can raise would reject payments.
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).toContain('RAISE WARNING');
  });

  it('pins search_path on every SECURITY DEFINER function', () => {
    // Comment lines mention SECURITY DEFINER too; count only the declarations.
    const code = sql
      .split('\n')
      .filter(line => !line.trimStart().startsWith('--') && !line.trimStart().startsWith('*'))
      .join('\n');

    const definers = code.match(/SECURITY DEFINER/g) ?? [];
    const pinned = code.match(/SET search_path = public/g) ?? [];

    expect(definers.length).toBeGreaterThan(0);
    expect(pinned).toHaveLength(definers.length);
  });

  it('uses the invoice amount column that exists', () => {
    // `payment_invoices` has `amount`. It has no `total` and no `total_amount`.
    expect(sql).not.toMatch(/NEW\.total\b[\s\S]{0,40}invoice/);
    expect(sql).toMatch(/'invoice\.created'[\s\S]{0,200}NEW\.amount/);
  });

  it('is safe to apply twice', () => {
    const triggers = sql.match(/CREATE TRIGGER/g) ?? [];
    const drops = sql.match(/DROP TRIGGER IF EXISTS/g) ?? [];

    expect(drops).toHaveLength(triggers.length);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
  });
});
