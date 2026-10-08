/**
 * A quote request made from preview is a real quote request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `/api/website/proposal-request` required a `subdomain` or a `userCode`, by
 * schema, before anything else ran. That is true of a visitor on a published
 * site and false of the person most likely to use the form first: the owner,
 * previewing their own page from the website editor while signed in. The
 * preview sends neither on purpose — identifying the business from the session
 * is the arrangement, and `/api/website/booking/create` states it in a comment:
 * "if not provided, authenticated user is used (preview mode)".
 *
 * So every quote request from preview was refused with a 400 and nothing was
 * written. `quote_requested` had ZERO rows across every account from the day
 * the route was added, which is how we know it was never the regression it
 * looked like.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * The three parts that have to agree: the client omits both identifiers in
 * preview, the schema tolerates their absence, and the route resolves the owner
 * from the session instead — from the SESSION, never from the body, which is
 * the rule that keeps a public endpoint from writing into another business's
 * CRM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const FLOW = 'components/website/blocks/ProcessFlowSection.tsx';
const ROUTE = 'app/api/website/proposal-request/route.ts';
const SIBLING = 'app/api/website/booking/create/route.ts';

const flow = codeOf(FLOW);
const route = codeOf(ROUTE);

describe('the client omits both identifiers in preview', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(read(ROUTE)).toContain('preview mode');
    expect(route).not.toContain('NEITHER IDENTIFIER IS A VALID STATE');
  });

  it('sends neither a subdomain nor a user code from the editor', () => {
    const call = flow.indexOf("fetch('/api/website/proposal-request'");
    expect(call).toBeGreaterThan(-1);

    const payload = flow.slice(call, call + 900);
    expect(payload).toContain('subdomain: isPreview ? undefined');
    expect(payload).toContain('userCode: isPreview ? undefined');
  });

  it('does not fake the submission instead', () => {
    /*
     * A simulated success would leave the owner's own test invisible in their
     * CRM, which is the opposite of what they are testing FOR. The request is
     * real; only the identification differs.
     */
    const call = flow.indexOf("fetch('/api/website/proposal-request'");
    const before = flow.slice(Math.max(0, call - 500), call);
    expect(before).not.toMatch(/if \(isPreview\) \{[\s\S]*return;/);
  });
});

describe('the route accepts that and resolves the owner itself', () => {
  it('no longer demands one of the two identifiers up front', () => {
    // The refine ran before any resolution, so preview never reached the code
    // that could have identified the business.
    expect(route).not.toMatch(/\.refine\(\s*data => data\.subdomain \|\| data\.userCode/);
  });

  it('falls back to the signed-in user, as its sibling does', () => {
    expect(route).toMatch(/const user = await getUser\(\);/);
    expect(route).toMatch(/ownerId = user\.id;/);
    // The same shape the booking route already uses for this case.
    expect(codeOf(SIBLING)).toMatch(/ownerId = user\.id;/);
  });

  it('refuses rather than guesses when there is no session either', () => {
    const fallback = route.slice(route.indexOf('const user = await getUser()'), route.indexOf('ownerId = user.id;'));
    expect(fallback).toContain('status: 401');
  });

  it('never takes the owner from the request body', () => {
    // The rule that keeps one business from writing a lead into another's CRM.
    expect(route).not.toMatch(/ownerId = data\./);
    expect(route).not.toMatch(/user_id: data\./);
  });
});

describe('a consultation booked through a quote request is confirmed to the client', () => {
  /*
   * "Come and see it and I'll quote you" writes a booking like any other, with
   * `status: 'confirmed'`. Only the owner was told: the client picked a slot on
   * a public page, saw a confirmation screen, and received no date, no address
   * and no way to move it.
   */
  it('sends the same confirmation every other booking sends', () => {
    expect(route).toContain('BookingEmailService.sendBookingConfirmation(bookingId, ownerId)');
  });

  it('only when a time was actually booked', () => {
    // A quote request with no meeting has no booking to confirm, and inventing
    // one would be a confirmation of nothing.
    expect(route).toMatch(/bookingId\s*\n?\s*\? BookingEmailService\.sendBookingConfirmation/);
  });

  it('sends the request receipt instead when there is no meeting', () => {
    /*
     * A quoted service need not book anything: "tell me what you need and I'll
     * price it" produces a contact, an activity and no appointment. The client
     * still has to hear that it arrived, or a silent form is indistinguishable
     * from a broken one.
     */
    expect(route).toContain('sendQuoteReceivedEmail({');
    expect(route).toMatch(/: sendQuoteReceivedEmail\(\{/);
  });

  it('tells the owner in both cases', () => {
    // `notifyOwnerOfLead` sits outside the branch: the alert is about the
    // request, not about whether a slot came with it.
    const notifications = route.slice(route.indexOf('await Promise.allSettled(['), route.indexOf(']);'));
    expect(notifications).toContain('notifyOwnerOfLead({');
    expect(notifications.indexOf('notifyOwnerOfLead')).toBeLessThan(notifications.indexOf('bookingId'));
  });

  it('awaits the send rather than letting it float', () => {
    /*
     * A floating promise on a serverless function may never run: the instance
     * freezes the moment the response is returned. That is the fault that cost
     * this platform its booking confirmations once already.
     */
    expect(route).toMatch(/await Promise\.allSettled\(\[/);
    expect(route).not.toMatch(/notifyOwnerOfLead\(\{[\s\S]*?\}\)\.catch\(/);
  });

  it('lets neither email fail the request', () => {
    // The lead is saved and the activity logged; a missing email is
    // recoverable where a lost request is not.
    expect(route).toContain("'Owner alert failed (non-blocking)'");
    expect(route).toContain("'Client email failed (non-blocking)'");
  });

  it('reports which case a failed client email was', () => {
    // "No email arrived" is two different bugs depending on whether a meeting
    // was booked, and they live in different files.
    expect(route).toContain('hasConsultation: !!bookingId');
  });
});

describe('a refused quote request names the field', () => {
  it('warns before it answers 400', () => {
    const rejection = route.slice(route.indexOf('if (!parsed.success)'), route.indexOf('const data = parsed.data'));
    expect(rejection).toContain('requestLogger.warn');
    expect(rejection).toContain('status: 400');
  });

  it('logs field paths and codes, and never the values', () => {
    /*
     * Public and unauthenticated, carrying a name, an email and a phone number.
     * Logging what failed would put a stranger's contact details in the log
     * every time one of them mistyped their email.
     */
    const rejection = route.slice(route.indexOf('if (!parsed.success)'), route.indexOf('const data = parsed.data'));
    expect(rejection).toContain("issue.path.join('.')");
    expect(rejection).toContain('code: issue.code');
    expect(rejection).not.toMatch(/issue\.received/);
    expect(rejection).not.toMatch(/parsed\.data/);
  });
});
