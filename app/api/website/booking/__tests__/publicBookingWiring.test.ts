/**
 * The two ways a public booking can be written and still tell the client nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Both failures below were invisible to every other kind of test: the booking
 * row is correct, the service layer is correct, and the unit tests of both pass.
 * What broke was the wiring of the route around them, so this reads the source.
 *
 *   1. A FREE VARIABLE. `smartLinkRepository` lost its import in a tidy-up and
 *      kept its only call site. `resolveVisitorSessionId()` always returns an
 *      id, so every booking from `/site/{subdomain}/book` reached that line and
 *      threw `ReferenceError` — after the row was written and the confirmation
 *      dispatched. The catch returned 500, so the client was told the booking
 *      failed for a booking that exists.
 *
 *   2. WORK THAT OUTLIVES ITS REQUEST. The confirmation and the intake request
 *      were dispatched as bare promises and the response returned underneath
 *      them. A serverless invocation is frozen when it responds, so the email,
 *      the intake request and the CRM activity were dropped together with
 *      nothing rejecting and nothing logged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTES = join(__dirname, '..');

const CREATE = readFileSync(join(ROUTES, 'create', 'route.ts'), 'utf8');
const FINALIZE = readFileSync(join(ROUTES, 'finalize', 'route.ts'), 'utf8');

describe('a repository the route calls is a repository the route imports', () => {
  /**
   * Every `xRepository.` call in the file must have an import naming it. A
   * missing import is a ReferenceError at the moment it is reached, which for
   * this one was every booking made on a published site.
   */
  it.each([
    ['create', CREATE],
    ['finalize', FINALIZE],
  ])('%s imports every repository it calls', (_name, source) => {
    const called = new Set(
      [...source.matchAll(/\b([a-z][A-Za-z0-9]*Repository)\s*\n?\s*\./g)].map(m => m[1])
    );

    for (const identifier of called) {
      expect(source).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`)
      );
    }
  });
});

describe('the client hears about their own booking before the request ends', () => {
  it.each([
    ['create', CREATE],
    ['finalize', FINALIZE],
  ])('%s awaits the confirmation email rather than firing it off', (_name, source) => {
    // The send has to be inside an awaited expression. Matching the old shape
    // is what catches a revert: `sendBookingConfirmation(...).catch(...)` with
    // the response returned underneath it.
    expect(source).toContain('await Promise.allSettled([');
    expect(source).toMatch(/await Promise\.allSettled\(\[[\s\S]*?sendBookingConfirmation/);
    expect(source).not.toMatch(/sendBookingConfirmation\([\s\S]{0,400}?\)\s*\n?\s*\.catch\(/);
  });
});

/**
 * The route asks for the whole service row, not a list of columns.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THIRD TIME ONE HAND-TYPED SELECT BROKE SOMETHING SILENTLY.
 *
 * The route named eight columns of a thirty-column row, and the code below it
 * asks questions of fields that list could not know it would need. Everything
 * unnamed arrives `undefined`, so the question is answered — wrongly, quietly,
 * and in a direction that always looks like "no".
 *
 *   `collection`         omitted: "is money taken here at all" could not be
 *                        consulted even in principle, and fell back to price.
 *
 *   `sale_mode`          omitted one bug later: a quoted service has no price
 *                        yet, so it read as FREE, and free files the contact as
 *                        a client. Asking for a quote made you a client before
 *                        anyone had named a figure.
 *
 *   `payment_type` and   omitted: `isInstallmentPlan` inside
 *   `installment_count`  `createBookingInvoice` read two undefined fields,
 *                        answered "no plan", and billed the whole total as one
 *                        invoice. A service sold as "2 × ₪400" invoiced the
 *                        client ₪800 and wrote no instalments.
 *
 * The owner's path never had any of these, because it does not type a list:
 * `schedulingServiceRepository.findById` is `.select('*')`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE UNIT TESTS COULD NOT CATCH IT
 *
 * `BookingLifecycleService.planInvoice.test` proves `createBookingInvoice`
 * splits a plan correctly, and it passes. It hands the function a service
 * object directly, so it never sees what the CALLER asked the database for.
 * The defect lives in the gap between the two, which is the gap this file
 * exists to read.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The route with its comments removed.
 *
 * The fix is documented in a comment that QUOTES the cast it removed, so a
 * negative assertion read against the raw file fails on the explanation of the
 * bug it is guarding against — and gets deleted as flaky by whoever meets it
 * next.
 */
const CREATE_CODE = CREATE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the service is loaded whole', () => {
  it('comes from the repository, not a hand-typed select', () => {
    expect(CREATE).toMatch(
      /schedulingServiceRepository\.findById\(data\.service_id, ownerId\)/
    );
  });

  it('names no columns of scheduling_services anywhere', () => {
    /*
     * Not "names the plan columns" — that would pass the moment someone adds
     * the two that broke today and leave the next omission to be found in
     * production. The list itself is the defect.
     */
    const selects = CREATE_CODE.match(/from\('scheduling_services'\)[\s\S]{0,400}?\.select\(/g) ?? [];

    expect(selects).toHaveLength(0);
  });

  it('passes the service on without a cast', () => {
    /*
     * `service as never` is what kept TypeScript quiet. The repository returns
     * a real `SchedulingService`, whose type names `payment_type`,
     * `installment_count`, `installment_frequency`, `first_payment_due` and
     * `first_payment_days` — so the next reader can see they exist.
     */
    expect(CREATE_CODE).not.toMatch(/service as never/);
  });
});

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments first', () => {
    /* Without this, the cast assertion fails on the sentence describing the
       cast it removed. */
    expect(CREATE).toMatch(/service as never/);
    expect(CREATE_CODE).not.toMatch(/service as never/);
  });
});
