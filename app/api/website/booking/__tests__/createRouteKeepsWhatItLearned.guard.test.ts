/**
 * The twelve lessons in `create/route.ts` that nothing else guards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHARACTERISATION. This records what the route does TODAY.
 *
 * Step 2 of `docs/workplans/booking-created-only-when-the-client-completes.md`.
 * That plan moves the booking write OUT of this file, which means this file
 * gets gutted — and fifteen production bugs are recorded here in prose, with
 * three of them guarded.
 *
 * A rewrite will not fail when it undoes one of these. The comment will simply
 * start describing behaviour that no longer exists, and nobody will notice
 * until a client books an invoiced service from a business with no tax id, or
 * a quote request files somebody as a paying client again.
 *
 * Each `describe` is one entry from
 * `docs/workplans/public-booking-recorded-bugs-inventory.md`. #1, #4 and #14
 * are already covered by `publicBookingWiring.test.ts` and are not repeated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SOURCE, NOT BEHAVIOUR
 *
 * Reaching any of these lines needs a subdomain, a website page, a service, a
 * contact, a Stripe capability lookup and six Supabase tables. The existing
 * guard for this route reads the source for the stated reason: the row is
 * correct and the service layer is correct — what broke was the WIRING.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(process.cwd(), 'app/api/website/booking/create/route.ts'),
  'utf8'
);

/** Comments quote the old code and the bugs; assertions must not read them. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** A window of code starting at `needle`, for assertions about one block. */
const near = (needle: string, span = 400) => {
  const at = code.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  return code.slice(at, at + span);
};

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments that quote the old behaviour', () => {
    /* Not the full sentence: the comment wraps after "price". */
    expect(SOURCE).toContain('a quoted service has no price');
    expect(code).not.toContain('a quoted service has no price');
  });

  it('and keeps the code', () => {
    expect(code).toContain('const requiresPayment = shouldTakePayment(');
  });
});

describe('#2 · one definition of "can this business honour this"', () => {
  /* The owner's booking route and the website publish gate ask the same
     question. A second opinion per surface is how they drift. */
  it('comes from the shared readiness module', () => {
    expect(code).toContain("from '@/lib/business-os/journeyReadiness'");
    expect(code).toContain('journeyGaps');
    expect(code).toContain('isBlockingGap');
  });
});

describe('#3 · the visitor id travels in the body', () => {
  /*
   * `buildAttributionFromRequest` reads the request URL and finds nothing: this
   * is a POST to an API route, and `_sid` lives in the PAGE's url. Without it
   * the click that produced a booking can never be matched to it.
   */
  it('is accepted from the client', () => {
    expect(code).toContain('session_id: z.string().max(128).optional()');
  });
});

describe('#5 · the public route gates on readiness too', () => {
  /*
   * The owner's route has gated on this for some time, on the reasoning that a
   * client-side gate is a convenience and the route is the authority. The
   * PUBLIC route — the one a client actually uses — never asked at all. So a
   * client could book an invoiced service from a business with no invoice
   * company name, no tax id, no address and no payment instructions, and be
   * sent an invoice built from none of them.
   */
  it('asks before the booking is made', () => {
    const gate = near('await journeyGaps(ownerId', 500);

    expect(gate).toContain('service.service_name');
    expect(gate).toContain('service.collection');
  });

  it('refuses on a blocking gap rather than warning', () => {
    expect(code).toContain('isBlockingGap');
    expect(code.indexOf('journeyGaps(ownerId')).toBeLessThan(code.indexOf("from('scheduling_bookings')"));
  });
});

describe('#6 · the owner\'s holiday is not for sale', () => {
  /*
   * The slot list already applies closed days, so a client reaching here means
   * a page left open across the owner recording a holiday — or a POST that
   * never saw the list. A client cannot overrule the owner's diary the way the
   * owner can from their own calendar.
   */
  it('re-checks server-side, through the shared verdict', () => {
    expect(code).toContain("import { closedDayVerdict } from '@/lib/scheduling/closedDay';");
    expect(code).toContain('closedDayVerdict(');
  });
});

describe('#7 · "requires payment" is not "price > 0"', () => {
  /*
   * A service billed afterwards has a price and takes no card; a service set to
   * collect by card takes none either when the business has no processor. Both
   * were treated as requiring payment — which set the booking `pending`,
   * suppressed the confirmation email, and told the client to go and pay with
   * nothing on the other side. The invoice never went out either, because the
   * email that carries it is the one that was suppressed.
   */
  it('asks the shared helper, with all three inputs', () => {
    const decision = near('const requiresPayment = shouldTakePayment(', 260);

    expect(decision).toContain('price: service.price');
    expect(decision).toContain('collection: service.collection');
    expect(decision).toContain('processorReady: capability.canCollect');
  });

  it('the processor capability is resolved, not assumed', () => {
    expect(code).toContain('resolvePaymentCollectionCapability(supabaseServer, ownerId)');
  });

  it('nothing decides it from the price alone', () => {
    expect(code).not.toMatch(/requiresPayment\s*=\s*\(?\s*service\.price\s*(\|\|\s*0\s*\)?)?\s*>\s*0/);
  });
});

describe('#8 · the route does not decide the contact\'s stage', () => {
  /*
   * It used to — "free service, so they are a client now" — which is how a
   * quote request produced a client. `promote_contact_on_payment (which replaced the dropped promote_contact_on_confirmed_booking, 20260920)`
   * moves them when a booking is written `confirmed`: immediately for a free
   * service, never for a quote request. One rule, in one place, reached by
   * every path that confirms a booking.
   */
  it('a new contact starts at the first stage, always', () => {
    expect(code).toContain('const contactStage = firstStage;');
  });

  it('and not from the price or the sale mode', () => {
    /* The statement alone. A wider window runs into the log line below it,
       which names these legitimately. */
    const line = near('const contactStage =', 40);

    expect(line).not.toContain('price');
    expect(line).not.toContain('isQuoteRequest');
    expect(line).not.toContain('requiresPayment');
  });
});

describe('#9 · consent never costs a booking', () => {
  it('is fire-and-forget, after the contact', () => {
    /* A failure here loses a consent record, never a booking. */
    expect(code).toContain('void recordConsent({');
  });
});

describe('#10 · one purchase, one booking', () => {
  /*
   * This route inserted unconditionally, producing one booking per CALL. Two
   * rows landed 68ms apart from a double mount — only the second was ever paid,
   * the first sat `pending` forever. And a client who reached payment,
   * abandoned, and came back ten minutes later got a second booking for the
   * same seat.
   */
  it('looks for the unpaid booking this client already has', () => {
    /* Anchored on `pendingQuery`: the first `scheduling_bookings` in this file
       is the slot-overlap check, which is a different query entirely. */
    const q = near('let pendingQuery = supabaseServer', 420);

    expect(q).toContain("eq('service_id', data.service_id)");
    expect(q).toContain("eq('contact_id', contactId)");
    expect(q).toContain("eq('status', 'pending')");
    expect(q).toContain("eq('payment_status', 'pending')");
  });

  it('only an UNPAID one — a paid booking is a completed sale', () => {
    /* A client buying the same service again deserves a second booking; that is
       the case this must not collapse. */
    expect(near('let pendingQuery = supabaseServer', 420)).toContain("eq('payment_status', 'pending')");
  });

  it('matches the slot too, with `is` for a product and `eq` otherwise', () => {
    /*
     * Booking two different slots of the same service stays two bookings.
     * `eq(null)` matches nothing in PostgREST and would silently defeat this.
     */
    const q = near('pendingQuery = startTime', 220);

    expect(q).toContain("eq('start_time', startTime.toISOString())");
    expect(q).toContain("is('start_time', null)");
  });

  it('reuses rather than inserting', () => {
    expect(code).toContain('const insertResult = reusable');
  });
});

describe('#11 · the booking appears on the client\'s own timeline', () => {
  /*
   * Nothing recorded a booking being made: the drawer showed the emails about
   * it and never the event, so the first thing in a client's history was a
   * confirmation for something that appeared from nowhere.
   *
   * Written by Postgres trigger T2 on INSERT. The route must NOT insert it as
   * well — doing so double-logged the activity.
   */
  it('is left to the trigger, not inserted here', () => {
    const after = code.slice(code.indexOf('const insertResult = reusable'));
    const activityInsert = after.match(/from\('crm_activities'\)[\s\S]{0,120}insert\(/);

    expect(activityInsert).toBeNull();
  });
});

describe('#12 · an invoice-collected service gets an invoice', () => {
  /*
   * `collection: 'invoice'` means the money is not taken at booking — but it IS
   * owed. The website flow raised no invoice at all, so a ₪200 booking produced
   * a confirmation email, no bill, and nothing for the client to pay against.
   * Only the owner-created path invoiced.
   */
  it('calls the same producer the owner path uses', () => {
    /* Exported rather than copied: one invoice numbering sequence, one shape
       of row. */
    expect(code).toContain("await import('@/lib/services/BookingLifecycleService')");
    expect(code).toContain('createBookingInvoice(');
  });

  it('gated on the collection method, not on the price', () => {
    expect(code).toContain('if (billsByInvoice && contactId)');
  });
});

describe('#13 · no cast over the service', () => {
  /*
   * It was `service as never`, and that cast is precisely why the missing plan
   * columns never surfaced — it told TypeScript to stop checking the one shape
   * that would have named them.
   */
  it('the service reaches createBookingInvoice as itself', () => {
    expect(code).not.toContain('service as never');
    expect(near('createBookingInvoice(', 160)).toContain('service,');
  });
});

describe('#15 · the click is matched to the booking it produced', () => {
  /*
   * `markConversion` existed and was called by nothing, so no smart link ever
   * reported a conversion.
   */
  it('marks the conversion when a session id travelled', () => {
    /*
     * `sessionId`, not `data.session_id`. The id now has TWO sources — the
     * body, or the page url a smart link redirected through — resolved once
     * into a local:
     *
     *     const sessionId = data.session_id ?? sessionIdFromUrl(…) ?? null;
     *
     * Asserted on the resolved value rather than the body field, so a booking
     * that reached the page by smart link still reports its conversion.
     */
    const call = near('if (sessionId) {', 300);

    expect(call).toContain('markConversion(sessionId');
  });

  it('and a business never loses a booking because attribution failed', () => {
    /* This is bug #1 from the other direction: the call threw AFTER the row was
       written and the email dispatched, and the catch returned a 500 for a
       booking that exists. */
    expect(near('if (sessionId) {', 300)).toContain('.catch(');
  });
});
